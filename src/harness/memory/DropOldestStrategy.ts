import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';

export class DropOldestStrategy implements ContextStrategy {
  trim(history: Message[], maxContextChars: number): Message[] {
    let totalChars = history.reduce((sum, msg) => sum + msg.content.length, 0);
    const newHistory = [...history];

    // Keep trimming from the oldest messages as long as we are over the limit.
    // We trim in pairs (2 messages at a time) to maintain conversational alternation
    // (e.g., keeping user -> assistant chains intact), leaving at least 1 message.
    while (totalChars > maxContextChars && newHistory.length > 2) {
      const removed1 = newHistory.shift()!;
      const removed2 = newHistory.shift()!;
      totalChars -= (removed1.content.length + removed2.content.length);
    }

    return newHistory;
  }
}
