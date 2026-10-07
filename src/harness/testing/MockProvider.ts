import { Message, Provider } from '../types';

export type MockReply = string | Error | ((messages: Message[], systemPrompt?: string) => string | Promise<string>);

export interface MockCall {
  messages: Message[];
  systemPrompt?: string;
}

/**
 * Scripted fake Provider for hermetic tests: replies are consumed in order.
 * An Error reply is thrown; a function reply is called with the request.
 * When the script runs out it repeats `fallback` (default: an empty string).
 */
export class MockProvider implements Provider {
  public rpmLimit?: number;
  public calls: MockCall[] = [];
  private queue: MockReply[];

  constructor(replies: MockReply[] = [], private opts: { fallback?: MockReply; delayMs?: number; rpmLimit?: number } = {}) {
    this.queue = [...replies];
    this.rpmLimit = opts.rpmLimit;
  }

  async generate(messages: Message[], systemPrompt?: string): Promise<string> {
    // Copy so later history mutation/trimming does not alter what the provider saw.
    this.calls.push({ messages: messages.map(m => ({ ...m })), systemPrompt });
    if (this.opts.delayMs) await new Promise(r => setTimeout(r, this.opts.delayMs));
    const reply = this.queue.length > 0 ? this.queue.shift()! : (this.opts.fallback ?? '');
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(messages, systemPrompt);
    return reply;
  }
}
