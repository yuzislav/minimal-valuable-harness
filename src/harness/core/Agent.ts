import { Message, Provider, Tool, ToolCall } from '../types';
import { Skill } from '../skills';
import { ConversationMemory, ContextStrategyName } from '../memory/ConversationMemory';
import { ContextStrategy } from '../memory/ContextStrategy';
import { OutputParser } from '../parsers/OutputParser';
import { buildSystemPrompt } from '../utils/promptBuilder';
import { loadDefaultSystemPrompt } from '../utils/defaultPrompt';
import { createDebugLog } from '../utils/debug';
import { truncateText } from '../utils/truncate';

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_CONTEXT_CHARS = 16000;
const MAX_TOOL_RESULT_CHARS = 8000;

// Wait out the remainder of the minimum interval implied by the provider's RPM limit.
// Providers without an rpmLimit (e.g. local) are never throttled.
async function rpmDelay(rpmLimit: number | undefined, lastCallAt: number, debugLog: (...args: any[]) => void): Promise<void> {
  const intervalMs = rpmLimit && rpmLimit > 0 ? Math.ceil(60000 / rpmLimit) : 0;
  const waitMs = intervalMs - (Date.now() - lastCallAt);
  if (waitMs > 0) {
    debugLog(`[DEBUG] RPM throttle: waiting ${waitMs}ms (${rpmLimit} RPM limit)`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

// Serialise a tool result without throwing on BigInt or cyclic values; strings pass through unescaped.
function stringifyResult(value: any): string {
  if (typeof value === 'string') return value;
  const ancestors: any[] = [];
  try {
    const json = JSON.stringify(value, function (this: any, _key, val) {
      if (typeof val === 'bigint') return val.toString();
      if (val && typeof val === 'object') {
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
        if (ancestors.includes(val)) return '[Circular]';
        ancestors.push(val);
      }
      return val;
    }, 2);
    return json === undefined ? String(value) : json;
  } catch (e: any) {
    return `[Unserializable result: ${e.message || String(e)}]`;
  }
}

export interface AgentConfig {
  provider: Provider;
  tools: Tool[];
  skills: Skill[];
  /** Prompt template with an `{available_tools}` placeholder. Defaults to the bundled prompt for `toolFormat`. */
  systemPrompt?: string;
  maxIterations?: number;
  /** Context window in characters (not tokens), shared by the system prompt and the history. */
  maxContextChars?: number;
  /** Per-result cap in characters for tool output entering history. Default: min(8000, maxContextChars / 4). */
  maxToolResultChars?: number;
  toolFormat?: 'xml' | 'json';
  /** How history is trimmed once it exceeds the context window. Default: 'cut_middle'. */
  contextStrategy?: ContextStrategyName | ContextStrategy;
  /** Requests per minute; overrides `provider.rpmLimit`. 0 or unset means no throttling. */
  rpmLimit?: number;
  /** Print debug logs. Can be toggled at runtime via `agent.debug`. */
  debug?: boolean;
}

export class Agent {
  private config: AgentConfig & { systemPrompt: string };
  private memory: ConversationMemory;
  private parser: import('../parsers/OutputParser').IOutputParser;
  public lastRunIterations: number = 0;
  private lastCallAt: number = 0;
  // Chains concurrent run() calls so two messages for the same agent can never
  // interleave their history reads/writes (see F2).
  private runQueue: Promise<any> = Promise.resolve();

  public debug: boolean;
  private debugLog = createDebugLog(() => this.debug);

  constructor(config: AgentConfig) {
    const toolFormat = config.toolFormat || 'xml';
    const maxContextChars = config.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const systemPrompt = config.systemPrompt ?? loadDefaultSystemPrompt(toolFormat);
    if (!systemPrompt.includes('{available_tools}')) {
      throw new Error("AgentConfig.systemPrompt must contain the '{available_tools}' placeholder, otherwise the model is never told which tools exist.");
    }
    this.config = {
      ...config,
      systemPrompt,
      toolFormat,
      maxContextChars,
      maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      maxToolResultChars: config.maxToolResultChars ?? Math.min(MAX_TOOL_RESULT_CHARS, Math.floor(maxContextChars / 4)),
    };
    this.debug = config.debug ?? false;

    this.memory = new ConversationMemory(maxContextChars, { strategy: config.contextStrategy });
    
    if (this.config.toolFormat === 'json') {
      const { JsonOutputParser } = require('../parsers/JsonOutputParser');
      this.parser = new JsonOutputParser();
    } else {
      this.parser = new OutputParser();
    }
  }

  public clearHistory(): void {
    this.memory.clear();
  }

  public getHistory(): Message[] {
    return this.memory.getHistory();
  }

  public get maxContextChars(): number {
    return this.config.maxContextChars!;
  }

  public run(userInput: string): Promise<string> {
    const task = this.runQueue.then(() => this.runExclusive(userInput));
    this.runQueue = task.catch(() => {});
    return task;
  }

  private async runExclusive(userInput: string): Promise<string> {
    const historySnapshot = this.memory.snapshot();
    const systemPrompt = buildSystemPrompt(
      this.config.systemPrompt,
      this.config.skills,
      this.config.tools,
      this.config.toolFormat
    );
    const debugLog = this.debugLog;
    // The system prompt shares the context window with the history.
    this.memory.setReservedChars(systemPrompt.length);
    this.memory.addMessage({ role: 'user', content: userInput });
    debugLog(`\n[DEBUG] --- Iteration 0 (System Prompt) ---`);
    debugLog(systemPrompt);

    this.lastRunIterations = 0;
    let iterations = 0;
    while (iterations < this.config.maxIterations!) {
      this.lastRunIterations = iterations + 1;
      debugLog(`\n[DEBUG] --- Iteration ${iterations + 1} ---`);
      debugLog(`[DEBUG] Sending request to LLM with history length: ${this.memory.length}`);
      const debugHistory = this.memory.getHistory().map(msg => {
        if (msg.content.length > 200) {
          return { ...msg, content: msg.content.slice(0, 200) + `\n...[trimmed for debug, full length: ${msg.content.length} chars]` };
        }
        return msg;
      });
      debugLog(`[DEBUG] Current History:`, debugHistory);

      await rpmDelay(this.config.rpmLimit ?? this.config.provider.rpmLimit, this.lastCallAt, debugLog);

      let responseText: string;
      try {
        this.lastCallAt = Date.now();
        responseText = await this.config.provider.generate(this.memory.getHistory(), systemPrompt);
      } catch (error: any) {
        debugLog(`[DEBUG] Provider generation error:`, error);
        this.memory.restore(historySnapshot);
        return `Error communicating with the LLM provider: ${error.message || String(error)}`;
      }

      if (!responseText.trim()) {
        this.memory.restore(historySnapshot);
        return 'Error: the LLM provider returned an empty response.';
      }

      debugLog(`[DEBUG] Received response from LLM (length: ${responseText.length} chars):`);
      debugLog(responseText);

      this.memory.addMessage({ role: 'assistant', content: responseText });

      const { calls: toolCalls, errors: parseErrors } = this.parser.parseToolCalls(responseText);

      debugLog(`[DEBUG] Parsed tool calls: ${toolCalls.length}`);
      if (toolCalls.length > 0) {
        debugLog(`[DEBUG] Tool calls details:`, toolCalls);
      }
      if (parseErrors.length > 0) {
        debugLog(`[DEBUG] Parse errors:`, parseErrors);
      }

      if (toolCalls.length === 0 && parseErrors.length === 0) {
        return responseText;
      }

      const toolResults = await Promise.all(toolCalls.map(async (call: ToolCall) => {
        const tool = this.config.tools.find(t => t.name === call.name);
        if (!tool) {
          return { call, error: `Tool '${call.name}' not found.` };
        }

        // Validate arguments using Zod
        if (tool.parameters) {
          const { jsonSchemaToZod } = require('../utils/zodSchema');
          const zodSchema = jsonSchemaToZod(tool.parameters);
          const validation = zodSchema.safeParse(call.args);
          if (!validation.success) {
            const errorMessages = validation.error.issues.map((issue: any) => `Validation error at '${issue.path.join('.')}': ${issue.message}`).join(', ');
            return { call, error: `Invalid arguments for tool '${call.name}': ${errorMessages}` };
          }
          call.args = validation.data;
        }

        try {
          const result = await tool.execute(call.args);
          return { call, result };
        } catch (err: any) {
          return { call, error: err.message || String(err) };
        }
      }));

      const cap = this.config.maxToolResultChars!;
      let resultMessage = '';
      if (parseErrors.length > 0) {
        resultMessage += `Validation Errors in your tool calls:\n${parseErrors.join('\n')}\n\nPlease correct these errors and try again.\n`;
      }

      if (toolCalls.length > 0) {
        resultMessage += 'Tool execution results:\n';
        for (const res of toolResults) {
          resultMessage += `\nTool: ${res.call.name}\n`;
          if (res.error) {
            resultMessage += `Error: ${truncateText(res.error, cap)}\n`;
          } else {
            const resultStr = truncateText(stringifyResult(res.result), cap);
            resultMessage += `Result: ${resultStr}\n`;
          }
        }
      }

      this.memory.addMessage({ role: 'user', content: resultMessage });
      iterations++;
    }

    return "Error: Max iterations reached without completing the task.";
  }
}
