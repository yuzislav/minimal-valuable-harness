import { Message } from '../types';
import { truncateText } from '../utils/truncate';

const FEEDBACK_PREFIXES = ['Tool execution results:', 'Validation Errors in your tool calls:'];

// Never squash a message below this many characters when truncating to fit the budget.
const MIN_KEPT_CHARS = 200;
// Room reserved for the "...[truncated N chars]" marker so the result lands under the target.
const MARKER_ROOM = 40;

/** True for the harness-generated user messages that carry tool results or parse-error feedback. */
export function isFeedbackMessage(msg: Message): boolean {
  return msg.role === 'user' && FEEDBACK_PREFIXES.some(p => msg.content.startsWith(p));
}

/** Index of the first message of the current task: the last user message that is not harness feedback. */
export function findTaskStart(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user' && !isFeedbackMessage(history[i])) return i;
  }
  return 0;
}

export const totalChars = (history: Message[]): number => history.reduce((sum, m) => sum + m.content.length, 0);

/**
 * Removes the least valuable content in `history[0, taskStart)` and returns true,
 * or returns false when nothing outside the current task can be removed.
 */
export type DropStep = (history: Message[], taskStart: number) => boolean;

function shrink(history: Message[], index: number, targetChars: number): void {
  const target = Math.max(MIN_KEPT_CHARS, targetChars);
  const content = history[index].content;
  if (content.length <= target + MARKER_ROOM) return;
  history[index] = { ...history[index], content: truncateText(content, target - MARKER_ROOM) };
}

function largestIndex(history: Message[]): number {
  let best = 0;
  history.forEach((m, i) => { if (m.content.length > history[best].content.length) best = i; });
  return best;
}

/**
 * Fit `history` into `maxChars` without ever dropping the current task (its first user message
 * and its own tool rounds). A message of the current task that alone takes more than half the
 * budget is truncated first; then `drop` removes older content; if that is exhausted the largest
 * messages are truncated instead.
 */
export function fitToBudget(history: Message[], maxChars: number, drop: DropStep): Message[] {
  const h = [...history];
  let guard = 4 * h.length + 64;
  while (totalChars(h) > maxChars && guard-- > 0) {
    const big = largestIndex(h);
    const taskStart = findTaskStart(h);
    if (big >= taskStart && h[big].content.length > maxChars / 2 + MARKER_ROOM) {
      shrink(h, big, Math.floor(maxChars / 2));
      continue;
    }
    if (drop(h, taskStart)) continue;
    const before = totalChars(h);
    shrink(h, big, h[big].content.length - (before - maxChars));
    if (totalChars(h) >= before) break;
  }
  return h;
}
