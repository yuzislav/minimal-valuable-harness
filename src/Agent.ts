import { Message, Provider, Tool, ToolCall } from './types';
import { Skill } from './skills';

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
  private history: Message[] = [];
  
  constructor(config: AgentConfig) {
    this.config = config;
    // Default max iterations to 5, and max characters to 16,000 (~4k tokens)
    this.config.maxIterations = config.maxIterations ?? parseInt(process.env.MAX_ITERATIONS || '5', 10);
    this.config.maxContextChars = config.maxContextChars ?? parseInt(process.env.MAX_CONTEXT_CHARS || '16000', 10);
  }

  /**
   * Generates the system prompt including skills and tools.
   */
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
        prompt += `- ${tool.name}: ${tool.description}\n  Parameters: ${JSON.stringify(tool.parameters)}\n`;
      }
      
      prompt += `\nTo call tools, output a JSON array of tool calls inside a \`\`\`json block. 
Example:
\`\`\`json
[
  {
    "name": "exec",
    "args": { "code": "console.log('Hello');" }
  }
]
\`\`\`
You can call multiple tools in the same array to execute them in parallel.
If you call a tool, wait for the user to provide the execution results before proceeding.`;
    }

    return prompt;
  }

  /**
   * Extracts tool calls from the LLM's raw text response.
   */
  private parseToolCalls(text: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const regex = /```json\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.name === 'string' && typeof item.args === 'object') {
              toolCalls.push(item);
            }
          }
        }
      } catch (e) {
        // Skip invalid JSON blocks
      }
    }
    return toolCalls;
  }

  /**
   * Prunes history to stay within maxContextChars using a rolling window approach.
   */
  private trimHistory() {
    let currentChars = this.history.reduce((sum, msg) => sum + msg.content.length, 0);
    // Keep trimming from the oldest message as long as we are over the limit
    while (currentChars > this.config.maxContextChars! && this.history.length > 1) {
      const removed = this.history.shift();
      if (removed) {
        currentChars -= removed.content.length;
      }
    }
  }

  /**
   * Main entrypoint to run the agent loop.
   */
  public async run(userInput: string): Promise<string> {
    this.history.push({ role: 'user', content: userInput });
    const systemPrompt = this.buildSystemPrompt();

    let iterations = 0;
    while (iterations < this.config.maxIterations!) {
      debugLog(`\n[DEBUG] --- Iteration ${iterations + 1} ---`);
      debugLog(`[DEBUG] Sending request to LLM with history length: ${this.history.length}`);
      debugLog(`[DEBUG] Current History:`, this.history);

      this.trimHistory();
      
      const responseText = await this.config.provider.generate(this.history, systemPrompt);
      
      debugLog(`[DEBUG] Received response from LLM (length: ${responseText.length} chars):`);
      debugLog(responseText);

      this.history.push({ role: 'assistant', content: responseText });

      const toolCalls = this.parseToolCalls(responseText);
      
      debugLog(`[DEBUG] Parsed tool calls: ${toolCalls.length}`);
      if (toolCalls.length > 0) {
        debugLog(`[DEBUG] Tool calls details:`, toolCalls);
      }

      if (toolCalls.length === 0) {
        return responseText; // No tools called, return final answer
      }

      // Execute tools in parallel
      const toolResults = await Promise.all(toolCalls.map(async (call) => {
        const tool = this.config.tools.find(t => t.name === call.name);
        if (!tool) {
          return { call, error: `Tool '${call.name}' not found.` };
        }
        try {
          const result = await tool.execute(call.args);
          return { call, result };
        } catch (err: any) {
          // Send errors back to the LLM for self-correction
          return { call, error: err.message || String(err) };
        }
      }));

      // Format results back into history
      let resultMessage = 'Tool execution results:\n';
      for (const res of toolResults) {
        resultMessage += `\nTool: ${res.call.name}\n`;
        if (res.error) {
          resultMessage += `Error: ${res.error}\n`;
        } else {
          resultMessage += `Result: ${JSON.stringify(res.result, null, 2)}\n`;
        }
      }

      this.history.push({ role: 'user', content: resultMessage });
      iterations++;
    }

    return "Error: Max iterations reached without completing the task.";
  }
}
