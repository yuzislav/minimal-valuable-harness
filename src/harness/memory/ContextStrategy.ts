import { Message } from '../types';

export interface ContextStrategy {
  trim(history: Message[], maxContextChars: number): Message[];
}
