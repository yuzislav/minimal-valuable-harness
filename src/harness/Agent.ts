import { Message, Provider, Tool, ToolCall } from './types';
import { Skill } from './skills';
import { ConversationMemory } from './ConversationMemory';
import { OutputParser } from './OutputParser';

const debugLog = (...args: any[]) => {
  if (process.env.DEBUG) {
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
    console.log(`\x1b[90m${message}\x1b[0m`);
  }
};

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

  private buildSystemPrompt(): string {
    let prompt = this.config.systemPrompt || 'You are a helpful AI assistant.';

    if (this.config.skills.length > 0) {
      prompt += '\n\nAvailable Skills (use the read_skill tool to see full details):\n';
      for (const skill of this.config.skills) {
        prompt += `- ${skill.name}: ${skill.description}\n`;
      }
    }

    if (this.config.tools.length > 0) {
      prompt += '\n\nAvailable Tools:\n';
      for (const tool of this.config.tools) {
        prompt += `<tool>\n`;
        prompt += `  <name>${tool.name}</name>\n`;
        prompt += `  <description>${tool.description}</description>\n`;
        prompt += `  <parameters>\n`;
        if (tool.parameters && tool.parameters.properties) {
          for (const [key, prop] of Object.entries(tool.parameters.properties)) {
            const type = (prop as any).type || 'string';
            const desc = (prop as any).description || '';
            prompt += `    <parameter name="${key}" type="${type}">${desc}</parameter>\n`;
          }
        }
        prompt += `  </parameters>\n`;
        prompt += `</tool>\n`;
      }

      prompt += `\nCRITICAL INSTRUCTIONS FOR TOOL CALLING:
You MUST output tools using EXACTLY the following XML format. Do NOT deviate.
<tool_call>
  <name>tool_name</name>
  <arguments>
    <arg_name>arg_value</arg_name>
  </arguments>
</tool_call>

- You MUST wrap your parameters inside an <arguments> block.
- You MUST use <name> for the tool's name.
- You can output multiple <tool_call> blocks to execute them in parallel.`;
    }

    return prompt;
  }

  public async run(userInput: string): Promise<string> {
    this.memory.addMessage({ role: 'user', content: userInput });
    const systemPrompt = this.buildSystemPrompt();
    debugLog(`\n[DEBUG] --- Iteration 0 (System Prompt) ---`);
    debugLog(systemPrompt);

    let iterations = 0;
    while (iterations < this.config.maxIterations!) {
      debugLog(`\n[DEBUG] --- Iteration ${iterations + 1} ---`);
      debugLog(`[DEBUG] Sending request to LLM with history length: ${this.memory.length}`);
      debugLog(`[DEBUG] Current History:`, this.memory.getHistory());

      const responseText = await this.config.provider.generate(this.memory.getHistory(), systemPrompt);

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

      const toolResults = await Promise.all(toolCalls.map(async (call) => {
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
