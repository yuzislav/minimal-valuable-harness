import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execTool } from '../src/harness/tools/exec';
import { curlTool } from '../src/harness/tools/curl';
import { loadMCPServers } from '../src/harness/mcp/MCPLoader';
import { MCPManager } from '../src/harness/mcp/index';
import { quiet } from './helpers';

test('exec: returns the script result and captured console output', async () => {
  const r = await execTool.execute({ code: 'console.log("a", 1); console.error("e"); 6 * 7' });
  assert.deepEqual(r, { result: 42, logs: ['a 1', 'ERROR: e'] });
});

test('exec: syntax and runtime errors become "Execution error"', async () => {
  await assert.rejects(() => execTool.execute({ code: 'throw new Error("nope")' }), /Execution error: nope/);
  await assert.rejects(() => execTool.execute({ code: 'let let' }), /Execution error/);
});

test('exec: missing code is rejected', async () => {
  await assert.rejects(() => execTool.execute({}), /Missing 'code'/);
});

test('F1: exec runs code in an isolated process with a hard timeout', { todo: 'F1 open: vm is not an isolation boundary' });

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}
const fakeResponse = (body: string, init: ResponseInit = {}) => async () => new Response(body, init);

test('curl: returns status, headers and body; forwards method/headers/body', async () => {
  let seen: any;
  const f = (async (url: any, opts: any) => { seen = { url, opts }; return new Response('hello', { status: 201, statusText: 'Created', headers: { 'x-a': 'b' } }); }) as typeof fetch;
  const r = await withFetch(f, () => curlTool.execute({ url: 'https://example.test/x', method: 'POST', headers: '{"h":"1"}', body: 'B' }));
  assert.equal(r.status, 201);
  assert.equal(r.data, 'hello');
  assert.equal(r.headers['x-a'], 'b');
  assert.deepEqual(seen, { url: 'https://example.test/x', opts: { method: 'POST', headers: { h: '1' }, body: 'B' } });
});

test('curl: missing url and fetch failures are errors', async () => {
  await assert.rejects(() => curlTool.execute({}), /Missing 'url'/);
  const f = (async () => { throw new Error('dns'); }) as typeof fetch;
  await withFetch(f, () => assert.rejects(() => curlTool.execute({ url: 'https://x.test' }), /HTTP Request failed: dns/));
});

test('F13: curl refuses loopback / link-local / private addresses', { todo: 'F13 open' }, async () => {
  let called = false;
  const f = (async () => { called = true; return new Response('secret'); }) as typeof fetch;
  await withFetch(f, async () => {
    for (const url of ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/']) {
      await assert.rejects(() => curlTool.execute({ url }), undefined, url);
    }
  });
  assert.equal(called, false);
});

test('F13: curl caps the returned body size', { todo: 'F13 open' }, async () => {
  const r = await withFetch(fakeResponse('A'.repeat(3_000_000)) as typeof fetch, () => curlTool.execute({ url: 'https://big.test/' }));
  assert.ok(r.data.length < 1_000_000);
});

test('F13: curl passes an abort signal so a stalled server cannot hang it', { todo: 'F13 open' }, async () => {
  let signal: any;
  const f = (async (_u: any, o: any) => { signal = o?.signal; return new Response('ok'); }) as typeof fetch;
  await withFetch(f, () => curlTool.execute({ url: 'https://x.test' }));
  assert.ok(signal, 'fetch received a signal');
});

test('F13: curl only allows http(s)', { todo: 'F13 open' }, async () => {
  const f = (async () => new Response('x')) as typeof fetch;
  await withFetch(f, () => assert.rejects(() => curlTool.execute({ url: 'file:///etc/hosts' })));
});

async function inTempCwd<T>(mcpJson: string | null, fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mvh-mcp-'));
  const prev = process.cwd();
  try {
    if (mcpJson !== null) await writeFile(path.join(dir, 'mcp.json'), mcpJson);
    process.chdir(dir);
    return await fn();
  } finally {
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
  }
}

test('F16: no mcp.json means no servers and no tools', async () => {
  await inTempCwd(null, async () => {
    const tools: any[] = [];
    assert.deepEqual(await quiet(() => loadMCPServers(tools)), []);
    assert.deepEqual(tools, []);
  });
});

test('F16: a server with a missing binary degrades gracefully with zero tools', async () => {
  const cfg = JSON.stringify({ mcpServers: { ghost: { command: '/nonexistent/mvh-no-such-binary', args: [] }, nocmd: {} } });
  await inTempCwd(cfg, async () => {
    const tools: any[] = [];
    await quiet(() => loadMCPServers(tools));
    assert.deepEqual(tools, []);
  });
});

test('F16: malformed mcp.json does not throw', async () => {
  await inTempCwd('{ not json', async () => {
    assert.deepEqual(await quiet(() => loadMCPServers([])), []);
  });
});

test('F16: a server that failed to connect is not returned as an active manager', { todo: 'F16 open' }, async () => {
  const cfg = JSON.stringify({ mcpServers: { ghost: { command: '/nonexistent/mvh-no-such-binary' } } });
  await inTempCwd(cfg, async () => {
    assert.equal((await quiet(() => loadMCPServers([]))).length, 0);
  });
});

test('F16: mcp.json is resolved from the project root, not the cwd', { todo: 'F16 open' }, async () => {
  const originalConnect = MCPManager.prototype.connect;
  const originalLoadTools = MCPManager.prototype.loadTools;
  MCPManager.prototype.connect = async function () {};
  MCPManager.prototype.loadTools = async function () { return []; };
  const cfg = JSON.stringify({ mcpServers: { fake: { command: 'node' } } });
  const root = await mkdtemp(path.join(tmpdir(), 'mvh-mcp-root-'));
  const nested = path.join(root, 'nested');
  await mkdir(nested);
  await writeFile(path.join(root, 'mcp.json'), cfg);
  const prev = process.cwd();
  try {
    process.chdir(nested);
    const managers = await quiet(() => loadMCPServers([]));
    assert.equal(managers.length, 1);
  } finally {
    process.chdir(prev);
    await rm(root, { recursive: true, force: true });
    MCPManager.prototype.connect = originalConnect;
    MCPManager.prototype.loadTools = originalLoadTools;
  }
});

test('F16: MCP tool errors are thrown, not returned as values', { todo: 'F16 open' }, async () => {
  const manager = new MCPManager('node', []);
  (manager as any).client = {
    listTools: async () => ({ tools: [{ name: 'boom', description: '', inputSchema: {} }] }),
    callTool: async () => { throw new Error('boom failed'); },
  };
  const tools = await manager.loadTools();
  await assert.rejects(() => tools[0].execute({}), /boom failed/);
});

test('F16: MCP tool names that collide with built-in tools are namespaced or rejected', { todo: 'F16 open' }, async () => {
  const originalConnect = MCPManager.prototype.connect;
  const originalLoadTools = MCPManager.prototype.loadTools;
  MCPManager.prototype.connect = async function () {};
  MCPManager.prototype.loadTools = async function () {
    return [{ name: 'echo', description: 'fake mcp echo', parameters: {}, execute: async () => 'mcp' }];
  };
  const cfg = JSON.stringify({ mcpServers: { fake: { command: 'node' } } });
  try {
    await inTempCwd(cfg, async () => {
      const tools: any[] = [{ name: 'echo', description: 'builtin', parameters: {}, execute: async () => 'builtin' }];
      await quiet(() => loadMCPServers(tools));
      assert.equal(tools.filter((t) => t.name === 'echo').length, 1);
    });
  } finally {
    MCPManager.prototype.connect = originalConnect;
    MCPManager.prototype.loadTools = originalLoadTools;
  }
});
