import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';
import { DropOldestStrategy } from './DropOldestStrategy';
import { CutMiddleStrategy } from './CutMiddleStrategy';
import { totalChars } from './trimming';

export type ContextStrategyName = 'cut_middle' | 'drop_oldest';

export interface ConversationMemoryOptions {
  strategy?: ContextStrategyName | ContextStrategy;
}

export function createContextStrategy(name: string): ContextStrategy {
  switch (name.toLowerCase()) {
    case 'cut_middle': return new CutMiddleStrategy();
    case 'drop_oldest': return new DropOldestStrategy();
    default: throw new Error(`Unknown context strategy '${name}'. Use 'cut_middle' or 'drop_oldest'.`);
  }
}

export class ConversationMemory {
  private history: Message[] = [];
  private strategy: ContextStrategy;
  private reservedChars = 0;

  constructor(private maxContextChars: number, options: ConversationMemoryOptions = {}) {
    const strategy = options.strategy ?? 'cut_middle';
    this.strategy = typeof strategy === 'string' ? createContextStrategy(strategy) : strategy;
  }

  /** Characters of the context window used by things outside the history, i.e. the system prompt. */
  public setReservedChars(chars: number): void {
    this.reservedChars = Math.max(0, chars);
  }

  /** The history budget: the window minus the reserved chars, but never less than a quarter of the window. */
  public get budgetChars(): number {
    return Math.max(this.maxContextChars - this.reservedChars, Math.floor(this.maxContextChars / 4));
  }

  public clear(): void {
    this.history = [];
  }

  public getHistory(): Message[] {
    return this.history;
  }

  public addMessage(message: Message): void {
    const beforeLength = this.history.length + 1;
    const beforeChars = totalChars(this.history) + message.content.length;
    this.history = this.strategy.trim([...this.history, message], this.budgetChars);
    const removed = beforeLength - this.history.length;
    const afterChars = totalChars(this.history);
    if (removed > 0 || afterChars < beforeChars) {
      console.log(`\x1b[33m[System]: Context trimmed. Removed ${removed} messages (${beforeChars - afterChars} chars in total) to fit within ${this.budgetChars} chars.\x1b[0m`);
    }
  }

  public snapshot(): Message[] {
    return [...this.history];
  }

  public restore(snapshot: Message[]): void {
    this.history = [...snapshot];
  }

  public get length(): number {
    return this.history.length;
  }
}
