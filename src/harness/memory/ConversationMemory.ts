import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';
import { DropOldestStrategy } from './DropOldestStrategy';
import { CutMiddleStrategy } from './CutMiddleStrategy';

const debugLog = (...args: any[]) => {
  if (process.env.DEBUG && process.env.DEBUG !== 'false') {
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
    console.log(`\x1b[90m${message}\x1b[0m`);
  }
};

export class ConversationMemory {
  private history: Message[] = [];
  private strategy: ContextStrategy;

  constructor(private maxContextChars: number) {
    const strategyName = process.env.CONTEXT_STRATEGY?.toLowerCase() || 'cut_middle';
    if (strategyName === 'cut_middle') {
      this.strategy = new CutMiddleStrategy();
    } else {
      this.strategy = new DropOldestStrategy();
    }
  }

  public clear(): void {
    this.history = [];
  }

  public getHistory(): Message[] {
    return this.history;
  }

  public addMessage(message: Message): void {
    this.history.push(message);
    const beforeLength = this.history.length;
    this.history = this.strategy.trim(this.history, this.maxContextChars);
    if (this.history.length < beforeLength) {
      console.log(`\x1b[33m[System]: Context trimmed. Removed ${beforeLength - this.history.length} messages to fit within ${this.maxContextChars} chars.\x1b[0m`);
    }
  }

  public get length(): number {
    return this.history.length;
  }
}
