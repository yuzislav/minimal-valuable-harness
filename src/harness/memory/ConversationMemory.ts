import { Message } from '../types';

export class ConversationMemory {
  private history: Message[] = [];
  private totalChars: number = 0;

  constructor(private maxContextChars: number) {}

  public clear(): void {
    this.history = [];
    this.totalChars = 0;
  }

  public getHistory(): Message[] {
    return this.history;
  }

  public addMessage(message: Message): void {
    this.history.push(message);
    this.totalChars += message.content.length;
    this.trimHistory();
  }

  private trimHistory(): void {
    // Keep trimming from the oldest messages as long as we are over the limit.
    // We trim in pairs (2 messages at a time) to maintain conversational alternation
    // (e.g., keeping user -> assistant chains intact), leaving at least 1 message.
    while (this.totalChars > this.maxContextChars && this.history.length > 2) {
      // Remove two messages to maintain turn order
      const removed1 = this.history.shift()!;
      const removed2 = this.history.shift()!;
      this.totalChars -= (removed1.content.length + removed2.content.length);
    }
  }

  public get length(): number {
    return this.history.length;
  }
}
