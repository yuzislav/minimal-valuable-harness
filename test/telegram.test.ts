import test from 'node:test';
import assert from 'node:assert/strict';
import { quiet } from './helpers';

// node-telegram-bot-api's constructor starts real network polling, so every
// test here stubs it out via node:test's module mocking (never touches the
// network and never spins a real timer/CPU loop).
class FakeBot {
  public sent: Array<{ chatId: any; text: string }> = [];
  public handlers: Record<string, (...args: any[]) => any> = {};
  constructor(_token: string, _opts: any) {}
  on(event: string, handler: (...args: any[]) => any) { this.handlers[event] = handler; }
  setMyCommands() { return Promise.resolve(); }
  sendMessage(chatId: any, text: string) { this.sent.push({ chatId, text }); return Promise.resolve(); }
  stopPolling() { return Promise.resolve(); }
}

let lastFakeBot: FakeBot | undefined;
class FakeBotFactory extends FakeBot {
  constructor(token: string, opts: any) { super(token, opts); lastFakeBot = this; }
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const noopRegistry = { getCommands: () => [], process: async () => false } as any;

test('F2: TelegramUI refuses to start with no allow-list and TELEGRAM_ALLOW_ALL unset', async () => {
  await withEnv({ TELEGRAM_ALLOWED_USERS: undefined, TELEGRAM_ALLOW_ALL: undefined }, async () => {
    const { TelegramUI } = await import('../src/ui/TelegramUI');
    assert.throws(
      () => new TelegramUI('tok', () => ({} as any), noopRegistry, [], []),
      /TELEGRAM_ALLOWED_USERS/
    );
  });
});

test('F2: TelegramUI starts when TELEGRAM_ALLOW_ALL=true with no allow-list', async (t) => {
  t.mock.module('node-telegram-bot-api', { exports: { default: FakeBotFactory } });
  await withEnv({ TELEGRAM_ALLOWED_USERS: undefined, TELEGRAM_ALLOW_ALL: 'true' }, async () => {
    const { TelegramUI } = await import('../src/ui/TelegramUI?allow-all');
    await quiet(async () => {
      assert.doesNotThrow(() => new TelegramUI('tok', () => ({} as any), noopRegistry, [], []));
    });
  });
});

test('F2: TelegramUI matches users by numeric ID, not username', async (t) => {
  t.mock.module('node-telegram-bot-api', { exports: { default: FakeBotFactory } });
  await withEnv({ TELEGRAM_ALLOWED_USERS: '42', TELEGRAM_ALLOW_ALL: undefined }, async () => {
    const { TelegramUI } = await import('../src/ui/TelegramUI?numeric-id');
    const agent = { run: async () => 'reply' };
    const bot = await quiet(async () => {
      new TelegramUI('tok', () => agent as any, noopRegistry, [], []);
      return lastFakeBot!;
    });

    // Same numeric id as a username string must NOT match (numeric-ID-only matching).
    await quiet(() => bot.handlers['message']({ chat: { id: 1 }, text: 'hi', from: { id: 7, username: '42' } }));
    assert.equal(bot.sent.at(-1)?.text, 'Sorry, you are not authorized to use this bot.');

    // The actual numeric id matches.
    await quiet(() => bot.handlers['message']({ chat: { id: 1 }, text: 'hi', from: { id: 42, username: 'someone' } }));
    assert.equal(bot.sent.at(-1)?.text, 'reply');
  });
});

test('F2: TelegramUI splits replies longer than 4096 chars and never sends an empty message', async (t) => {
  t.mock.module('node-telegram-bot-api', { exports: { default: FakeBotFactory } });
  await withEnv({ TELEGRAM_ALLOWED_USERS: '1', TELEGRAM_ALLOW_ALL: undefined }, async () => {
    const { TelegramUI } = await import('../src/ui/TelegramUI?chunking');
    let reply = 'A'.repeat(5000);
    const agent = { run: async () => reply };
    const bot = await quiet(async () => {
      new TelegramUI('tok', () => agent as any, noopRegistry, [], []);
      return lastFakeBot!;
    });

    await quiet(() => bot.handlers['message']({ chat: { id: 9 }, text: 'go', from: { id: 1 } }));
    const chunks = bot.sent.filter(s => s.chatId === 9);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text.length, 4096);
    assert.equal(chunks[1].text.length, 904);
    assert.equal(chunks[0].text + chunks[1].text, reply);

    bot.sent.length = 0;
    reply = '';
    await quiet(() => bot.handlers['message']({ chat: { id: 9 }, text: 'go again', from: { id: 1 } }));
    assert.equal(bot.sent.filter(s => s.chatId === 9).length, 0);
  });
});

test('F2: concurrent messages to the same chat do not corrupt that chat\'s history', async (t) => {
  t.mock.module('node-telegram-bot-api', { exports: { default: FakeBotFactory } });
  await withEnv({ TELEGRAM_ALLOWED_USERS: '1', TELEGRAM_ALLOW_ALL: undefined }, async () => {
    const { TelegramUI } = await import('../src/ui/TelegramUI?concurrency');
    const { Agent } = await import('../src/harness/core/Agent');
    const { MockProvider } = await import('../src/harness/testing/MockProvider');
    const provider = new MockProvider(['ans1', 'ans2'], { delayMs: 2 });
    const agent = new Agent({ provider, tools: [], skills: [] });
    const bot = await quiet(async () => {
      new TelegramUI('tok', () => agent, noopRegistry, [], []);
      return lastFakeBot!;
    });

    await quiet(() => Promise.all([
      bot.handlers['message']({ chat: { id: 5 }, text: 'first', from: { id: 1 } }),
      bot.handlers['message']({ chat: { id: 5 }, text: 'second', from: { id: 1 } }),
    ]));

    assert.deepEqual(agent.getHistory().map((m: any) => `${m.role}:${m.content}`),
      ['user:first', 'assistant:ans1', 'user:second', 'assistant:ans2']);
  });
});
