import { Message } from '../types';
import { ContextStrategy } from './ContextStrategy';
import { fitToBudget, isFeedbackMessage } from './trimming';

export class CutMiddleStrategy implements ContextStrategy {
  trim(history: Message[], maxContextChars: number): Message[] {
    return fitToBudget(history, maxContextChars, (h, taskStart) => {
      // 1. Prefer cutting intermediate [assistant, tool-feedback] pairs of finished tasks.
      for (let i = 1; i + 1 < taskStart; i += 2) {
        if (h[i].role === 'assistant' && isFeedbackMessage(h[i + 1])) {
          h.splice(i, 2);
          return true;
        }
      }

      // 2. Otherwise drop the oldest finished task pair after the initial one, so the
      // conversation's first prompt keeps anchoring the context.
      if (taskStart >= 4) {
        h.splice(2, 2);
        return true;
      }

      // 3. Last resort before the current task: drop from the absolute oldest.
      if (taskStart >= 1) {
        h.splice(0, Math.min(2, taskStart));
        return true;
      }
      return false;
    });
  }
}
