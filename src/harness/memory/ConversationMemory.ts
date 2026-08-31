import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';
import { DropOldestStrategy } from './DropOldestStrategy';
import { CutMiddleStrategy } from './CutMiddleStrategy';

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
    this.history = this.strategy.trim(this.history, this.maxContextChars);
  }

  public get length(): number {
    return this.history.length;
  }
}
