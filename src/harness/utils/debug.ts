/** Build a grey console logger that only prints while `isEnabled()` is true. */
export function createDebugLog(isEnabled: () => boolean): (...args: any[]) => void {
  return (...args: any[]) => {
    if (!isEnabled()) return;
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
    console.log(`\x1b[90m${message}\x1b[0m`);
  };
}
