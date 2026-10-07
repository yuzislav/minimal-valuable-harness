import { Tool } from '../src/harness/types';

export const xmlCall = (name: string, args: Record<string, string> = {}) =>
  `<tool_call><name>${name}</name><arguments>${Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</arguments></tool_call>`;

export function echoTool(log: any[] = []): Tool {
  return {
    name: 'echo',
    description: 'Echoes text',
    parameters: { type: 'object', properties: { text: { type: 'string', description: 'text' } }, required: ['text'] },
    execute: async (args) => { log.push(args); return { echoed: args.text }; },
  };
}

/** Silence console.log/warn/error for the duration of fn (library code prints). */
export async function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}
