import * as fs from 'fs';
import * as path from 'path';

/** Load the bundled system prompt template for a tool-call format. */
export function loadDefaultSystemPrompt(toolFormat: 'xml' | 'json' = 'xml'): string {
  return fs.readFileSync(path.join(__dirname, '..', 'prompts', `systemPrompt.${toolFormat}.md`), 'utf-8');
}
