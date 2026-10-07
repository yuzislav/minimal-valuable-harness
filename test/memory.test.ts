import test from 'node:test';
import assert from 'node:assert/strict';
import { CutMiddleStrategy } from '../src/harness/memory/CutMiddleStrategy';
import { DropOldestStrategy } from '../src/harness/memory/DropOldestStrategy';
import { ConversationMemory } from '../src/harness/memory/ConversationMemory';
import { Message } from '../src/harness/types';
import { quiet } from './helpers';

const msg = (role: Message['role'], content: string): Message => ({ role, content });
const total = (h: Message[]) => h.reduce((s, m) => s + m.content.length, 0);

test('both strategies leave history under the limit untouched', () => {
  const h = [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')];
  assert.deepEqual(new CutMiddleStrategy().trim(h, 100), h);
  assert.deepEqual(new DropOldestStrategy().trim(h, 100), h);
});

test('trim does not mutate its input', () => {
  const h = [msg('user', 'x'.repeat(50)), msg('assistant', 'y'.repeat(50)), msg('user', 'z')];
  new DropOldestStrategy().trim(h, 10);
  assert.equal(h.length, 3);
});

test('DropOldest drops oldest pairs first', () => {
  const h = [msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2'), msg('assistant', 'a2'), msg('user', 'u3')];
  const r = new DropOldestStrategy().trim(h, 8);
  assert.deepEqual(r.map(m => m.content), ['u2', 'a2', 'u3']);
});

test('CutMiddle keeps the first message and drops the oldest finished task after it', () => {
  const h = [msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2'), msg('assistant', 'a2'), msg('user', 'u3')];
  const r = new CutMiddleStrategy().trim(h, 8);
  assert.deepEqual(r.map(m => m.content), ['u1', 'a1', 'u3']);
});

test('CutMiddle removes an intermediate tool pair before anything else', () => {
  const h = [
    msg('user', 'Q'), msg('assistant', 'call1'), msg('user', 'Tool execution results:\nr1'),
    msg('assistant', 'call2'), msg('user', 'Tool execution results:\nr2'),
  ];
  const r = new CutMiddleStrategy().trim(h, 45);
  assert.equal(r[0].content, 'Q');
  assert.equal(r.length, 3);
});

test('ConversationMemory snapshot/restore/clear', async () => {
  const m = new ConversationMemory(1000);
  await quiet(() => m.addMessage(msg('user', 'a')));
  const snap = m.snapshot();
  await quiet(() => m.addMessage(msg('assistant', 'b')));
  m.restore(snap);
  assert.equal(m.length, 1);
  m.clear();
  assert.equal(m.length, 0);
});

test('ConversationMemory honours CONTEXT_STRATEGY', async () => {
  const saved = process.env.CONTEXT_STRATEGY;
  try {
    process.env.CONTEXT_STRATEGY = 'drop_oldest';
    const m = new ConversationMemory(5);
    await quiet(() => { m.addMessage(msg('user', 'aaaa')); m.addMessage(msg('assistant', 'bbbb')); m.addMessage(msg('user', 'cc')); });
    assert.deepEqual(m.getHistory().map(x => x.content), ['cc']);
  } finally {
    if (saved === undefined) delete process.env.CONTEXT_STRATEGY; else process.env.CONTEXT_STRATEGY = saved;
  }
});

const bigResult = () => [
  msg('user', 'Summarise https://example.com/big'),
  msg('assistant', '<tool_call><name>curl</name></tool_call>'),
  msg('user', 'Tool execution results:\n' + 'x'.repeat(50000)),
];

for (const [name, S] of [['CutMiddle', CutMiddleStrategy], ['DropOldest', DropOldestStrategy]] as const) {
  test(`F3-A (${name}): one huge tool result must not drop the user's question`, { todo: 'F3 open' }, () => {
    const r = new S().trim(bigResult(), 16000);
    assert.ok(r.some(m => m.content.startsWith('Summarise')), 'user question kept');
  });
}

test('F3-B: earlier rounds of the running task are not deleted mid-task', { todo: 'F3 open' }, () => {
  let h: Message[] = [msg('user', 'Q0 compare many things')];
  for (let i = 1; i <= 5; i++) {
    h.push(msg('assistant', `<tool_call><name>t${i}</name></tool_call>`));
    h.push(msg('user', `Tool execution results:\nRESULT_${i} ` + 'y'.repeat(3000)));
    h = new CutMiddleStrategy().trim(h, 10000);
  }
  assert.ok(h.some(m => m.content.includes('RESULT_1')), 'round 1 still present');
});

test('F3: validation-error feedback messages are recognised as intermediate steps', { todo: 'F3 open' }, () => {
  const h = [
    msg('user', 'Q'), msg('assistant', 'bad call'), msg('user', 'Validation Errors in your tool calls:\n' + 'e'.repeat(100)),
    msg('assistant', 'final'), msg('user', 'next'),
  ];
  const r = new CutMiddleStrategy().trim(h, 20);
  assert.ok(!r.some(m => m.content.startsWith('Validation Errors')));
  assert.equal(r[0].content, 'Q');
});
