/** Keep the first `keepChars` characters of `text` and append a visible marker saying how much was cut. */
export function truncateText(text: string, keepChars: number): string {
  const keep = Math.max(0, Math.floor(keepChars));
  if (text.length <= keep) return text;
  return `${text.slice(0, keep)}\n...[truncated ${text.length - keep} chars]`;
}
