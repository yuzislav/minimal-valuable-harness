import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/harness/core/Agent';
import { MockProvider } from '../src/harness/testing/MockProvider';
import { Tool } from '../src/harness/types';
import { createAgentFromEnv } from '../src/harness/createAgent';
import { echoTool, quiet, xmlCall } from './helpers';

const mk = (provider: MockProvider, tools: Tool[] = [echoTool()], extra: object = {}) =>
  new Agent({ provider, tools, skills: [], systemPrompt: 'T:\n{available_tools}', ...extra });

const run = (agent: Agent, input: string) => quiet(() => agent.run(input));

test('returns a plain answer after one LLM call', async () => {
  const p = new MockProvider(['hello']);
  const a = mk(p);
  assert.equal(await run(a, 'hi'), 'hello');
  assert.deepEqual(a.getHistory().map(m => m.role), ['user', 'assistant']);
  assert.match(p.calls[0].systemPrompt!, /<name>echo<\/name>/);
});

test('executes a tool call and feeds the result back', async () => {
  const log: any[] = [];
  const p = new MockProvider([xmlCall('echo', { text: 'ping' }), 'done']);
  const a = mk(p, [echoTool(log)]);
  assert.equal(await run(a, 'go'), 'done');
  assert.deepEqual(log, [{ text: 'ping' }]);
  const fed = p.calls[1].messages.at(-1)!;
  assert.equal(fed.role, 'user');
  assert.match(fed.content, /Tool execution results:[\s\S]*Tool: echo[\s\S]*"echoed": "ping"/);
  assert.equal(a.lastRunIterations, 2);
});

test('runs parallel tool calls in order', async () => {
  const p = new MockProvider([xmlCall('echo', { text: 'a' }) + xmlCall('echo', { text: 'b' }), 'ok']);
  await run(mk(p), 'go');
  const fed = p.calls[1].messages.at(-1)!.content;
  assert.ok(fed.indexOf('"a"') < fed.indexOf('"b"'));
});

test('a thrown tool error is fed back as an Error line', async () => {
  const boom: Tool = { ...echoTool(), name: 'boom', parameters: undefined, execute: async () => { throw new Error('kaput'); } };
  const p = new MockProvider([xmlCall('boom'), 'recovered']);
  assert.equal(await run(mk(p, [boom]), 'go'), 'recovered');
  assert.match(p.calls[1].messages.at(-1)!.content, /Tool: boom\nError: kaput/);
});

test('unknown tool and invalid arguments are fed back', async () => {
  const p = new MockProvider([xmlCall('nope') + xmlCall('echo'), 'fine']);
  await run(mk(p), 'go');
  const fed = p.calls[1].messages.at(-1)!.content;
  assert.match(fed, /Tool 'nope' not found/);
  assert.match(fed, /Invalid arguments for tool 'echo': Validation error at 'text'/);
});

test('parse errors are fed back alongside the retry request', async () => {
  const p = new MockProvider(['<tool_call><name>echo</name>', 'ok']);
  await run(mk(p), 'go');
  assert.match(p.calls[1].messages.at(-1)!.content, /Validation Errors in your tool calls:[\s\S]*unclosed/);
});

test('stops at maxIterations', async () => {
  const p = new MockProvider([], { fallback: xmlCall('echo', { text: 'x' }) });
  const a = mk(p, [echoTool()], { maxIterations: 3 });
  assert.equal(await run(a, 'loop'), 'Error: Max iterations reached without completing the task.');
  assert.equal(p.calls.length, 3);
  assert.equal(a.lastRunIterations, 3);
});

test('F8: Agent ignores MAX_ITERATIONS in process.env and defaults to 5', async () => {
  const saved = process.env.MAX_ITERATIONS;
  try {
    process.env.MAX_ITERATIONS = '4';
    const p = new MockProvider([], { fallback: xmlCall('echo', { text: 'x' }) });
    await run(mk(p), 'loop');
    assert.equal(p.calls.length, 5);
  } finally {
    if (saved === undefined) delete process.env.MAX_ITERATIONS; else process.env.MAX_ITERATIONS = saved;
  }
});

test('F8: createAgentFromEnv reads MAX_ITERATIONS from the given env', async () => {
  const p = new MockProvider([], { fallback: xmlCall('echo', { text: 'x' }) });
  const a = createAgentFromEnv({ provider: p, tools: [echoTool()] }, { MAX_ITERATIONS: '4' });
  await run(a, 'loop');
  assert.equal(p.calls.length, 4);
});

test('F9: BigInt and cyclic tool results do not reject run()', async () => {
  const cyc: any = {}; cyc.self = cyc;
  const weird: Tool = { ...echoTool(), name: 'weird', parameters: undefined, execute: async (a) => (a.k === 'big' ? 10n : cyc) };
  const p = new MockProvider([xmlCall('weird', { k: 'big' }) + xmlCall('weird', { k: 'cyc' }), 'ok']);
  assert.equal(await run(mk(p, [weird]), 'go'), 'ok');
  const fed = p.calls[1].messages.at(-1)!.content;
  assert.match(fed, /Result: "10"/);
  assert.match(fed, /\[Circular\]/);
});

test('F9: string results pass through unescaped', async () => {
  const s: Tool = { ...echoTool(), name: 's', parameters: undefined, execute: async () => 'line1\nline2' };
  const p = new MockProvider([xmlCall('s'), 'ok']);
  await run(mk(p, [s]), 'go');
  assert.match(p.calls[1].messages.at(-1)!.content, /Result: line1\nline2/);
});

test('F14: provider error rolls back the whole turn', async () => {
  const a = mk(new MockProvider([new Error('boom')]));
  assert.match(await run(a, 'q1'), /Error communicating with the LLM provider: boom/);
  assert.deepEqual(a.getHistory(), []);
});

test('F14: provider error mid-task rolls back tool rounds too', async () => {
  const a = mk(new MockProvider([xmlCall('echo', { text: 'x' }), new Error('late')]));
  await run(a, 'q');
  assert.deepEqual(a.getHistory(), []);
});

test('F14: empty model reply is an error and leaves no history', async () => {
  const a = mk(new MockProvider(['']));
  assert.match(await run(a, 'q'), /empty response/);
  assert.deepEqual(a.getHistory(), []);
});

test('F11: no throttle sleep after the final answer / without rpmLimit', async () => {
  const start = Date.now();
  await run(mk(new MockProvider(['x'], { rpmLimit: 0 })), 'q');
  assert.ok(Date.now() - start < 500);
});

test('F11: throttle applies only between consecutive calls', async () => {
  // 60000 / 6000 rpm = 10ms between calls
  const p = new MockProvider([xmlCall('echo', { text: 'x' }), 'done'], { rpmLimit: 6000 });
  const start = Date.now();
  await run(mk(p), 'q');
  assert.ok(Date.now() - start >= 9);
});

test('F4: Agent without systemPrompt tells the model about its tools', async () => {
  const p = new MockProvider(['hi']);
  await run(new Agent({ provider: p, tools: [echoTool()], skills: [] }), 'hello');
  assert.match(p.calls[0].systemPrompt!, /<name>echo<\/name>/);
  assert.match(p.calls[0].systemPrompt!, /<tool_call>/);
});

test('F4: default prompt follows toolFormat', async () => {
  const p = new MockProvider(['hi']);
  await run(new Agent({ provider: p, tools: [echoTool()], skills: [], toolFormat: 'json' }), 'hello');
  assert.match(p.calls[0].systemPrompt!, /"name": "echo"/);
  assert.doesNotMatch(p.calls[0].systemPrompt!, /<tool_call>/);
});

test('F4: a custom prompt without {available_tools} is rejected', () => {
  assert.throws(
    () => new Agent({ provider: new MockProvider(), tools: [], skills: [], systemPrompt: 'You are helpful.' }),
    /\{available_tools\}/);
});

test('F4: Agent takes strategy, rate limit and debug from its config, not process.env', async () => {
  const saved = { ...process.env };
  try {
    process.env.DEBUG = 'true';
    process.env.CONTEXT_STRATEGY = 'drop_oldest';
    process.env.GEMINI_RPM_LIMIT = '1';
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: any[]) => { lines.push(a.join(' ')); };
    const start = Date.now();
    try {
      const p = new MockProvider([xmlCall('echo', { text: 'x' }), 'done'], { rpmLimit: 6000 });
      await mk(p).run('q');
    } finally { console.log = log; }
    assert.ok(Date.now() - start < 1000, 'GEMINI_RPM_LIMIT env is not applied');
    assert.ok(!lines.some(l => l.includes('[DEBUG]')), 'DEBUG env does not enable logging');
  } finally {
    for (const k of ['DEBUG', 'CONTEXT_STRATEGY', 'GEMINI_RPM_LIMIT']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

test('F4: AgentConfig.rpmLimit overrides the provider and debug can be toggled at runtime', async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: any[]) => { lines.push(a.join(' ')); };
  const start = Date.now();
  try {
    const p = new MockProvider([xmlCall('echo', { text: 'x' }), 'done']);
    const a = mk(p, [echoTool()], { rpmLimit: 6000, debug: true });
    await a.run('q');
    assert.ok(lines.some(l => l.includes('[DEBUG]')));
    lines.length = 0;
    a.debug = false;
    p.calls.length = 0;
    await a.run('again');
    assert.ok(!lines.some(l => l.includes('[DEBUG]')));
  } finally { console.log = log; }
  assert.ok(Date.now() - start >= 9, 'rpmLimit from config throttles consecutive calls');
});

test('F4: createAgentFromEnv wires provider, format, strategy and context size from env', () => {
  const a = createAgentFromEnv({}, { LLM_PROVIDER: 'local', TOOL_FORMAT: 'json', LOCAL_CONTEXT_CHARS: '5000', CONTEXT_STRATEGY: 'drop_oldest', DEBUG: 'true' });
  assert.equal(a.maxContextChars, 5000);
  assert.equal(a.debug, true);
});

test('F4: createAgentFromEnv still reads the legacy *_CONTEXT_LENGTH name and validates values', () => {
  assert.equal(createAgentFromEnv({}, { LLM_PROVIDER: 'local', LOCAL_CONTEXT_LENGTH: '7000' }).maxContextChars, 7000);
  assert.throws(() => createAgentFromEnv({}, { LLM_PROVIDER: 'local', LOCAL_CONTEXT_CHARS: 'lots' }), /LOCAL_CONTEXT_CHARS/);
  assert.throws(() => createAgentFromEnv({}, { LLM_PROVIDER: 'local', CONTEXT_STRATEGY: 'bogus' }), /bogus/);
  assert.throws(() => createAgentFromEnv({}, { LLM_PROVIDER: 'local', TOOL_FORMAT: 'yaml' }), /TOOL_FORMAT/);
  assert.throws(() => createAgentFromEnv({}, {}), /GEMINI_API_KEY/);
});

test('F4: createAgentFromEnv overrides win over env', () => {
  const a = createAgentFromEnv({ provider: new MockProvider(), maxContextChars: 123 }, { LLM_PROVIDER: 'local', LOCAL_CONTEXT_CHARS: '5000' });
  assert.equal(a.maxContextChars, 123);
});

test('F3: a huge tool result is capped with a visible marker before entering history', async () => {
  const big: Tool = { ...echoTool(), name: 'big', parameters: { type: 'object', properties: {} }, execute: async () => 'x'.repeat(50000) };
  const p = new MockProvider([xmlCall('big'), 'summary']);
  const a = new Agent({ provider: p, tools: [big], skills: [], systemPrompt: '{available_tools}', maxContextChars: 40000 });
  assert.equal(await run(a, 'Summarise the big thing'), 'summary');
  const fed = p.calls[1].messages;
  assert.equal(fed[0].content, 'Summarise the big thing');
  const result = fed.at(-1)!.content;
  assert.match(result, /\.\.\.\[truncated 42000 chars\]/);
  assert.ok(result.length < 9000);
});

test('F3: tool errors are capped too', async () => {
  const bad: Tool = { ...echoTool(), name: 'bad', parameters: { type: 'object', properties: {} }, execute: async () => { throw new Error('e'.repeat(20000)); } };
  const p = new MockProvider([xmlCall('bad'), 'ok']);
  await run(new Agent({ provider: p, tools: [bad], skills: [], systemPrompt: '{available_tools}', maxToolResultChars: 100 }), 'go');
  assert.match(p.calls[1].messages.at(-1)!.content, /\.\.\.\[truncated 19900 chars\]/);
});

test('F3: a long task on a small window keeps the question and the system prompt is counted', async () => {
  const t: Tool = { ...echoTool(), name: 't', parameters: { type: 'object', properties: {} }, execute: async () => 'r'.repeat(3000) };
  const replies = [xmlCall('t'), xmlCall('t'), xmlCall('t'), xmlCall('t'), 'final'];
  const p = new MockProvider(replies);
  const prompt = 'S'.repeat(2000) + '\n{available_tools}';
  const a = new Agent({ provider: p, tools: [t], skills: [], systemPrompt: prompt, maxContextChars: 8000, maxIterations: 10 });
  assert.equal(await run(a, 'Q0 compare many things'), 'final');
  for (const call of p.calls) {
    assert.equal(call.messages[0].content, 'Q0 compare many things', 'question always present');
    const used = call.systemPrompt!.length + call.messages.reduce((n, m) => n + m.content.length, 0);
    assert.ok(used <= 8000 + 1, `request of ${used} chars fits the 8000 window`);
  }
});

test('F2: concurrent Agent.run calls keep history alternating', async () => {
  const p = new MockProvider(['ans1', 'ans2'], { delayMs: 2 });
  const a = mk(p);
  await quiet(() => Promise.all([a.run('first'), a.run('second')]));
  assert.deepEqual(a.getHistory().map(m => `${m.role}:${m.content}`),
    ['user:first', 'assistant:ans1', 'user:second', 'assistant:ans2']);
});

test('F10: JSON tool format executes fenced calls through the agent', async () => {
  const log: any[] = [];
  const p = new MockProvider(['```json\n[{"name":"echo","arguments":{"text":"hi"}}]\n```', 'All set.']);
  const a = mk(p, [echoTool(log)], { toolFormat: 'json' });
  assert.equal(await run(a, 'go'), 'All set.');
  assert.deepEqual(log, [{ text: 'hi' }]);
});

test('F7: JSON-mode answer with brackets is returned, not looped', { todo: 'F7 open' }, async () => {
  const p = new MockProvider([], { fallback: 'The array [1, 2, 3] sums to 6.' });
  const a = mk(p, [echoTool()], { toolFormat: 'json' });
  assert.equal(await run(a, 'sum'), 'The array [1, 2, 3] sums to 6.');
});
