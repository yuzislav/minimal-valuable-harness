import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execTool } from '../src/harness/tools/exec';
import { curlTool, _internal as curlInternal } from '../src/harness/tools/curl';
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

test('F1: exec runs in a separate process with no filesystem/subprocess access', async () => {
  await assert.rejects(
    () => execTool.execute({ code: 'require("fs").readFileSync("/etc/hosts", "utf8")' }),
    /Execution error:.*(restricted|permission)/i
  );
  await assert.rejects(
    () => execTool.execute({ code: 'require("child_process").execSync("echo hi")' }),
    /Execution error:.*(restricted|permission)/i
  );
});

test('F1: exec runs with a scrubbed environment (no host secrets)', async () => {
  process.env.MVH_TEST_SECRET = 'should-not-leak';
  try {
    const r = await execTool.execute({ code: 'process.env.MVH_TEST_SECRET' });
    assert.equal(r.result, undefined);
  } finally {
    delete process.env.MVH_TEST_SECRET;
  }
});

test('F1: exec has a hard timeout that also covers async work after it returns', async () => {
  const start = Date.now();
  // The pending timer keeps the process alive long after the synchronous
  // eval() returns, exercising the async-continuation case from F1.
  await assert.rejects(
    () => execTool.execute({ code: 'setTimeout(() => {}, 60000); "started"' }),
    /Execution error:.*timed out/
  );
  assert.ok(Date.now() - start < 10_000, 'killed well before the 60s the script scheduled');
});

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}
const fakeResponse = (body: string, init: ResponseInit = {}) => async () => new Response(body, init);

// Stubs DNS resolution so curl's private-range check never touches the real network.
async function withLookup<T>(map: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = curlInternal.lookup;
  curlInternal.lookup = (async (hostname: string) => {
    if (!(hostname in map)) throw new Error(`no DNS stub for ${hostname}`);
    return [{ address: map[hostname], family: 4 }] as any;
  }) as any;
  try { return await fn(); } finally { curlInternal.lookup = saved; }
}

const PUBLIC_IP = '203.0.113.5'; // TEST-NET-3, documentation-only but not loopback/private/link-local

test('curl: returns status, headers and body; forwards method/headers/body', async () => {
  let seen: any;
  const f = (async (url: any, opts: any) => { seen = { url: String(url), opts }; return new Response('hello', { status: 201, statusText: 'Created', headers: { 'x-a': 'b' } }); }) as typeof fetch;
  const r = await withLookup({ 'example.test': PUBLIC_IP }, () =>
    withFetch(f, () => curlTool.execute({ url: 'https://example.test/x', method: 'POST', headers: '{"h":"1"}', body: 'B' }))
  );
  assert.equal(r.status, 201);
  assert.equal(r.data, 'hello');
  assert.equal(r.headers['x-a'], 'b');
  assert.equal(seen.url, 'https://example.test/x');
  assert.equal(seen.opts.method, 'POST');
  assert.deepEqual(seen.opts.headers, { h: '1' });
  assert.equal(seen.opts.body, 'B');
  assert.equal(seen.opts.redirect, 'manual');
  assert.ok(seen.opts.signal, 'fetch received a signal');
});

test('curl: missing url and fetch failures are errors', async () => {
  await assert.rejects(() => curlTool.execute({}), /Missing 'url'/);
  const f = (async () => { throw new Error('dns'); }) as typeof fetch;
  await withLookup({ 'x.test': PUBLIC_IP }, () =>
    withFetch(f, () => assert.rejects(() => curlTool.execute({ url: 'https://x.test' }), /HTTP Request failed: dns/))
  );
});

test('F13: curl refuses loopback / link-local / private addresses', async () => {
  let called = false;
  const f = (async () => { called = true; return new Response('secret'); }) as typeof fetch;
  await withFetch(f, async () => {
    for (const url of ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::1]/', 'http://[fd00::1]/']) {
      await assert.rejects(() => curlTool.execute({ url }), undefined, url);
    }
  });
  assert.equal(called, false);
});

test('F13: curl resolves hostnames and blocks ones that resolve to a private address', async () => {
  let called = false;
  const f = (async () => { called = true; return new Response('secret'); }) as typeof fetch;
  await withLookup({ 'internal.test': '10.1.2.3' }, () =>
    withFetch(f, () => assert.rejects(() => curlTool.execute({ url: 'http://internal.test/' })))
  );
  assert.equal(called, false);
});

test('F13: CURL_ALLOW_PRIVATE=true opts back into private addresses', async () => {
  process.env.CURL_ALLOW_PRIVATE = 'true';
  try {
    const f = (async () => new Response('secret')) as typeof fetch;
    const r = await withFetch(f, () => curlTool.execute({ url: 'http://127.0.0.1/secret' }));
    assert.equal(r.data, 'secret');
  } finally {
    delete process.env.CURL_ALLOW_PRIVATE;
  }
});

test('F13: curl re-checks the address after a redirect', async () => {
  const f = (async (url: any) => {
    if (String(url) === 'https://example.test/start') {
      return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } });
    }
    throw new Error('should not be reached: ' + url);
  }) as typeof fetch;
  await withLookup({ 'example.test': PUBLIC_IP }, () =>
    withFetch(f, () => assert.rejects(() => curlTool.execute({ url: 'https://example.test/start' })))
  );
});

test('F13: curl drops credentials on a cross-origin redirect', async () => {
  const seen: Record<string, any>[] = [];
  const f = (async (url: any, opts: any) => {
    seen.push({ url: String(url), headers: opts.headers });
    if (String(url) === 'https://a.test/start') {
      return new Response(null, { status: 302, headers: { Location: 'https://b.test/next' } });
    }
    return new Response('ok');
  }) as typeof fetch;
  await withLookup({ 'a.test': PUBLIC_IP, 'b.test': PUBLIC_IP }, () =>
    withFetch(f, () => curlTool.execute({ url: 'https://a.test/start', headers: { Authorization: 'Bearer x', 'X-Keep': '1' } }))
  );
  assert.equal(seen[0].headers.Authorization, 'Bearer x');
  assert.equal(seen[1].headers.Authorization, undefined);
  assert.equal(seen[1].headers['X-Keep'], '1');
});

test('F13: curl enforces the private-address block at connect time (DNS rebinding)', async () => {
  const saved = curlInternal.lookup;
  let calls = 0;
  curlInternal.lookup = (async () => (++calls === 1 ? [{ address: PUBLIC_IP, family: 4 }] : [{ address: '127.0.0.1', family: 4 }])) as any;
  try {
    await assert.rejects(() => curlTool.execute({ url: 'http://rebind.test/' }), /blocked/);
  } finally {
    curlInternal.lookup = saved;
  }
});

test('F13: curl caps the returned body size', async () => {
  const r = await withLookup({ 'big.test': PUBLIC_IP }, () =>
    withFetch(fakeResponse('A'.repeat(3_000_000)) as typeof fetch, () => curlTool.execute({ url: 'https://big.test/' }))
  );
  assert.ok(r.data.length <= 1_000_000);
  assert.equal(r.truncated, true);
});

test('F13: curl passes an abort signal so a stalled server cannot hang it', async () => {
  let signal: any;
  const f = (async (_u: any, o: any) => { signal = o?.signal; return new Response('ok'); }) as typeof fetch;
  await withLookup({ 'x.test': PUBLIC_IP }, () => withFetch(f, () => curlTool.execute({ url: 'https://x.test' })));
  assert.ok(signal, 'fetch received a signal');
});

test('F13: curl only allows http(s)', async () => {
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
