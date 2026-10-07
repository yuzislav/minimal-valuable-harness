import { spawn } from 'child_process';
import { Tool } from '../types';

const TIMEOUT_MS = 5000;
const MAX_OLD_SPACE_MB = 64;
const MAX_OUTPUT_CHARS = 100_000;

// Wraps the user's code so console.log/error calls are captured as structured
// logs instead of writing straight to the child's inherited stdout/stderr.
function buildScript(code: string): string {
  // eval() preserves the vm/REPL completion-value semantics the tool had before
  // (the value of the last expression statement becomes the result).
  return `
    const __src = ${JSON.stringify(code)};
    const __logs = [];
    console.log = (...a) => __logs.push(a.map(String).join(' '));
    console.error = (...a) => __logs.push('ERROR: ' + a.map(String).join(' '));
    (async () => {
      try {
        const __result = await eval(__src);
        process.stdout.write(JSON.stringify({ ok: true, result: __result, logs: __logs }));
      } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e), logs: __logs }));
      }
    })();
  `;
}

function capture(stream: NodeJS.ReadableStream, maxChars: number): { get: () => string } {
  let buf = '';
  stream.on('data', (chunk) => {
    if (buf.length < maxChars) buf += chunk.toString();
  });
  return { get: () => buf.slice(0, maxChars) };
}

export const execTool: Tool = {
  name: 'exec',
  description: 'Executes JavaScript code in a locked-down, no-permission child process. Use this to run code or calculations. Returns the script result and console logs. This is process isolation (not a security sandbox): the process has no filesystem, network or subprocess permissions and a hard timeout, but it still shares the host kernel.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JavaScript code to execute. Can contain console.log.'
      }
    },
    required: ['code']
  },
  async execute(args: Record<string, any>): Promise<any> {
    const code = args.code;
    if (!code) {
      throw new Error("Missing 'code' argument");
    }

    const script = buildScript(code);

    const child = spawn(
      process.execPath,
      ['--permission', `--max-old-space-size=${MAX_OLD_SPACE_MB}`, '-e', script],
      {
        env: {},
        timeout: TIMEOUT_MS,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const stdout = capture(child.stdout, MAX_OUTPUT_CHARS);
    const stderr = capture(child.stderr, MAX_OUTPUT_CHARS);

    // `timeout`/`killSignal` above bound wall-clock time, including async
    // continuations that run after any synchronous evaluation returns.
    const exit: { code: number | null; signal: NodeJS.Signals | null } = await new Promise((resolve) => {
      child.on('error', () => resolve({ code: null, signal: null }));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });

    if (exit.signal === 'SIGKILL') {
      throw new Error(`Execution error: timed out after ${TIMEOUT_MS}ms and was killed`);
    }

    const out = stdout.get();
    let parsed: { ok: boolean; result?: any; error?: string; logs: string[] } | null = null;
    try {
      parsed = JSON.parse(out);
    } catch {
      // The child produced no valid JSON (e.g. it crashed before writing output).
    }

    if (!parsed) {
      const detail = stderr.get().trim() || out.trim() || `exit code ${exit.code}`;
      throw new Error(`Execution error: ${detail}`);
    }

    if (!parsed.ok) {
      throw new Error(`Execution error: ${parsed.error}`);
    }

    return { result: parsed.result, logs: parsed.logs };
  }
};
