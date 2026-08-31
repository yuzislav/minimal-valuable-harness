import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';

export class CutMiddleStrategy implements ContextStrategy {
  trim(history: Message[], maxContextChars: number): Message[] {
    let totalChars = history.reduce((sum, msg) => sum + msg.content.length, 0);
    const newHistory = [...history];

    while (totalChars > maxContextChars && newHistory.length > 3) {
      let removed = false;

      // 1. Prioritize cutting intermediate tool calls/results from the middle.
      // We look for [assistant, user] pairs where the user message is a tool result.
      for (let i = 1; i < newHistory.length - 2; i += 2) {
        const asstMsg = newHistory[i];
        const userMsg = newHistory[i + 1];

        if (asstMsg.role === 'assistant' && userMsg.role === 'user') {
          if (userMsg.content.startsWith('Tool execution results:')) {
            const r1 = newHistory.splice(i, 1)[0];
            const r2 = newHistory.splice(i, 1)[0];
            totalChars -= (r1.content.length + r2.content.length);
            removed = true;
            break;
          }
        }
      }

      // 2. If no intermediate steps were found, we are full of finalized tasks.
      // E.g.: [user(T1), asst(T1), user(T2), asst(T2), user(T3)...]
      // To preserve boundaries, we drop the oldest complete task *after* the initial one.
      // This means removing index 2 and 3.
      if (!removed && newHistory.length >= 5) {
        const r1 = newHistory.splice(2, 1)[0];
        const r2 = newHistory.splice(2, 1)[0];
        totalChars -= (r1.content.length + r2.content.length);
        removed = true;
      }

      if (!removed) {
        break; // Break to fallback if we can't safely cut from the middle anymore
      }
    }

    // 3. Fallback: If it's still too large (e.g. length is small but messages are huge),
    // we have to drop from the absolute oldest (sacrificing the first prompt).
    while (totalChars > maxContextChars && newHistory.length > 2) {
      const removed1 = newHistory.shift()!;
      const removed2 = newHistory.shift()!;
      totalChars -= (removed1.content.length + removed2.content.length);
    }

    return newHistory;
  }
}
