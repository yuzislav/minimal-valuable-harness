import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';
import { fitToBudget } from './trimming';

export class DropOldestStrategy implements ContextStrategy {
  trim(history: Message[], maxContextChars: number): Message[] {
    // Drop the oldest messages in pairs (to keep user/assistant alternation), but only
    // from before the current task, which is never dropped.
    return fitToBudget(history, maxContextChars, (h, taskStart) => {
      if (taskStart < 1) return false;
      h.splice(0, Math.min(2, taskStart));
      return true;
    });
  }
}
