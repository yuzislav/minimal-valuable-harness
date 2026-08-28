import { Message, Provider, Tool, ToolCall } from '../types';

export class ConversationMemory {
  private history: Message[] = [];

  constructor(private maxContextChars: number) {}

  public clear(): void {
    this.history = [];
  }

  public getHistory(): Message[] {
    return this.history;
  }

  public addMessage(message: Message): void {
    this.history.push(message);
    this.trimHistory();
  }

  private trimHistory(): void {
    let currentChars = this.history.reduce((sum, msg) => sum + msg.content.length, 0);
    // Keep trimming from the oldest message as long as we are over the limit
    while (currentChars > this.maxContextChars && this.history.length > 1) {
      const removed = this.history.shift();
      if (removed) {
        currentChars -= removed.content.length;
      }
    }
  }

  public get length(): number {
    return this.history.length;
  }
}
