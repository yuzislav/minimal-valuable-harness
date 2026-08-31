import { Message, Provider, Tool, ToolCall } from '../types';
import { Skill } from '../skills';
import { ConversationMemory } from '../memory/ConversationMemory';
import { OutputParser } from '../parsers/OutputParser';
import { buildSystemPrompt } from '../utils/promptBuilder';

const debugLog = (...args: any[]) => {
  if (process.env.DEBUG && process.env.DEBUG !== 'false') {
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
    console.log(`\x1b[90m${message}\x1b[0m`);
  }
};

// Respect RPM limit between LLM calls inside the agent loop.
// Uses GEMINI_RPM_LIMIT env var.
// Defaults to 0 (no delay) so interactive use isn't slowed down.
// Skipped for local providers which have no rate limits.
async function rpmDelay(): Promise<void> {
  if (process.env.LLM_PROVIDER?.toLowerCase() === 'local') return;
  const rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '0', 10);
  const waitMs = rpmLimit > 0 ? Math.ceil(60000 / rpmLimit) : 0;
  if (waitMs > 0) {
    debugLog(`[DEBUG] RPM throttle: waiting ${waitMs}ms (${rpmLimit} RPM limit)`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

export interface AgentConfig {
  provider: Provider;
  tools: Tool[];
  skills: Skill[];
  systemPrompt?: string;
  maxIterations?: number;
  maxContextChars?: number;
}

export class Agent {
  private config: AgentConfig;
  private memory: ConversationMemory;
  private parser: OutputParser;
  public lastRunIterations: number = 0;

  constructor(config: AgentConfig) {
    this.config = config;
    this.config.maxIterations = config.maxIterations ?? parseInt(process.env.MAX_ITERATIONS || '5', 10);
    this.config.maxContextChars = config.maxContextChars ?? parseInt(process.env.MAX_CONTEXT_CHARS || '16000', 10);

    this.memory = new ConversationMemory(this.config.maxContextChars);
    this.parser = new OutputParser();
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

  public async run(userInput: string): Promise<string> {
    this.memory.addMessage({ role: 'user', content: userInput });
    const systemPrompt = buildSystemPrompt(
      this.config.systemPrompt || 'You are a helpful AI assistant.',
      this.config.skills,
      this.config.tools
    );
    debugLog(`\n[DEBUG] --- Iteration 0 (System Prompt) ---`);
    debugLog(systemPrompt);

    this.lastRunIterations = 0;
    let iterations = 0;
    while (iterations < this.config.maxIterations!) {
      this.lastRunIterations = iterations + 1;
      debugLog(`\n[DEBUG] --- Iteration ${iterations + 1} ---`);
      debugLog(`[DEBUG] Sending request to LLM with history length: ${this.memory.length}`);
      debugLog(`[DEBUG] Current History:`, this.memory.getHistory());

      const responseText = await this.config.provider.generate(this.memory.getHistory(), systemPrompt);
      await rpmDelay();

      debugLog(`[DEBUG] Received response from LLM (length: ${responseText.length} chars):`);
      debugLog(responseText);

      this.memory.addMessage({ role: 'assistant', content: responseText });

      const toolCalls = this.parser.parseToolCalls(responseText);

      debugLog(`[DEBUG] Parsed tool calls: ${toolCalls.length}`);
      if (toolCalls.length > 0) {
        debugLog(`[DEBUG] Tool calls details:`, toolCalls);
      }

      if (toolCalls.length === 0) {
        return responseText;
      }

      const toolResults = await Promise.all(toolCalls.map(async (call: ToolCall) => {
        const tool = this.config.tools.find(t => t.name === call.name);
        if (!tool) {
          return { call, error: `Tool '${call.name}' not found.` };
        }
        try {
          const result = await tool.execute(call.args);
          return { call, result };
        } catch (err: any) {
          return { call, error: err.message || String(err) };
        }
      }));

      let resultMessage = 'Tool execution results:\n';
      for (const res of toolResults) {
        resultMessage += `\nTool: ${res.call.name}\n`;
        if (res.error) {
          resultMessage += `Error: ${res.error}\n`;
        } else {
          resultMessage += `Result: ${JSON.stringify(res.result, null, 2)}\n`;
        }
      }

      this.memory.addMessage({ role: 'user', content: resultMessage });
      iterations++;
    }

    return "Error: Max iterations reached without completing the task.";
  }
}
