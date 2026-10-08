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

test('CutMiddle removes an intermediate tool pair of a finished task before anything else', () => {
  const h = [
    msg('user', 'Q'), msg('assistant', 'call1'), msg('user', 'Tool execution results:\nr1'),
    msg('assistant', 'final'), msg('user', 'next'),
  ];
  const r = new CutMiddleStrategy().trim(h, 20);
  assert.deepEqual(r.map(m => m.content), ['Q', 'final', 'next']);
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

test('ConversationMemory uses the configured strategy, not process.env', async () => {
  const saved = process.env.CONTEXT_STRATEGY;
  try {
    process.env.CONTEXT_STRATEGY = 'cut_middle';
    const m = new ConversationMemory(5, { strategy: 'drop_oldest' });
    await quiet(() => { m.addMessage(msg('user', 'aaaa')); m.addMessage(msg('assistant', 'bbbb')); m.addMessage(msg('user', 'cc')); });
    assert.deepEqual(m.getHistory().map(x => x.content), ['cc']);
  } finally {
    if (saved === undefined) delete process.env.CONTEXT_STRATEGY; else process.env.CONTEXT_STRATEGY = saved;
  }
});

test('ConversationMemory rejects an unknown strategy name', () => {
  assert.throws(() => new ConversationMemory(100, { strategy: 'nope' as any }), /nope/);
});

test('ConversationMemory counts reserved (system prompt) chars against the window', async () => {
  const m = new ConversationMemory(100);
  m.setReservedChars(60);
  assert.equal(m.budgetChars, 40);
  m.setReservedChars(500);
  assert.equal(m.budgetChars, 25, 'budget never collapses below a quarter of the window');
  m.setReservedChars(60);
  await quiet(() => {
    m.addMessage(msg('user', 'old question'));
    m.addMessage(msg('assistant', 'a'.repeat(30)));
    m.addMessage(msg('user', 'new question'));
  });
  assert.deepEqual(m.getHistory().map(x => x.content), ['new question']);
});

const bigResult = () => [
  msg('user', 'Summarise https://example.com/big'),
  msg('assistant', '<tool_call><name>curl</name></tool_call>'),
  msg('user', 'Tool execution results:\n' + 'x'.repeat(50000)),
];

for (const [name, S] of [['CutMiddle', CutMiddleStrategy], ['DropOldest', DropOldestStrategy]] as const) {
  test(`F3-A (${name}): one huge tool result must not drop the user's question`, () => {
    const r = new S().trim(bigResult(), 16000);
    assert.ok(r.some(m => m.content.startsWith('Summarise')), 'user question kept');
  });
}

test('F3-B: earlier rounds of the running task are not deleted mid-task', () => {
  let h: Message[] = [msg('user', 'Q0 compare many things')];
  for (let i = 1; i <= 5; i++) {
    h.push(msg('assistant', `<tool_call><name>t${i}</name></tool_call>`));
    h.push(msg('user', `Tool execution results:\nRESULT_${i} ` + 'y'.repeat(3000)));
    h = new CutMiddleStrategy().trim(h, 10000);
  }
  assert.ok(h.some(m => m.content.includes('RESULT_1')), 'round 1 still present');
});

test('F3: validation-error feedback messages are recognised as intermediate steps', () => {
  const h = [
    msg('user', 'Q'), msg('assistant', 'bad call'), msg('user', 'Validation Errors in your tool calls:\n' + 'e'.repeat(100)),
    msg('assistant', 'final'), msg('user', 'next'),
  ];
  const r = new CutMiddleStrategy().trim(h, 20);
  assert.ok(!r.some(m => m.content.startsWith('Validation Errors')));
  assert.equal(r[0].content, 'Q');
});

for (const [name, S] of [['CutMiddle', CutMiddleStrategy], ['DropOldest', DropOldestStrategy]] as const) {
  test(`F3-A (${name}): the huge result is truncated with a marker and the call is kept`, () => {
    const r = new S().trim(bigResult(), 16000);
    assert.equal(r.length, 3);
    assert.ok(total(r) <= 16000);
    assert.match(r[2].content, /^Tool execution results:/);
    assert.match(r[2].content, /\.\.\.\[truncated \d+ chars\]$/);
  });

  test(`F3 (${name}): the current task is never dropped, older tasks go first`, () => {
    const h = [
      msg('user', 'old q'.repeat(10)), msg('assistant', 'old a'.repeat(10)),
      msg('user', 'Q'), msg('assistant', 'call'), msg('user', 'Tool execution results:\n' + 'r'.repeat(60)),
    ];
    const r = new S().trim(h, 100);
    assert.deepEqual(r.map(m => m.content.slice(0, 5)), ['Q', 'call', 'Tool ']);
  });

  test(`F3 (${name}): an oversized question alone is truncated, never dropped`, () => {
    const r = new S().trim([msg('user', 'q'.repeat(5000))], 1000);
    assert.equal(r.length, 1);
    assert.ok(total(r) <= 1000);
    assert.match(r[0].content, /\.\.\.\[truncated \d+ chars\]$/);
  });
}

test('F3: validation feedback inside the running task is protected too', () => {
  const h = [
    msg('user', 'old'), msg('assistant', 'old a'),
    msg('user', 'Q'), msg('assistant', 'bad'), msg('user', 'Validation Errors in your tool calls:\nboom'),
  ];
  const r = new CutMiddleStrategy().trim(h, 40);
  assert.deepEqual(r.map(m => m.content.slice(0, 5)), ['Q', 'bad', 'Valid']);
});

test('F3-B: under a tight window every round of the running task is kept, shrunk instead', () => {
  let h: Message[] = [msg('user', 'Q0')];
  for (let i = 1; i <= 5; i++) {
    h.push(msg('assistant', `call-${i}`));
    h.push(msg('user', `Tool execution results:\nRESULT_${i} ` + 'y'.repeat(3000)));
    h = new CutMiddleStrategy().trim(h, 4000);
  }
  assert.equal(h.length, 11);
  assert.ok(total(h) <= 4000);
  for (let i = 1; i <= 5; i++) assert.ok(h.some(m => m.content.includes(`RESULT_${i}`)));
});
