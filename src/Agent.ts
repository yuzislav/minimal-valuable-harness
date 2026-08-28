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
   * Clears the agent's conversation history.
   */
  public clearHistory(): void {
    this.history = [];
  }

  /**
   * Returns the agent's current conversation history.
   */
  public getHistory(): Message[] {
    return this.history;
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

  /**
   * Extracts tool calls from the LLM's raw text response.
   */
  private parseToolCalls(text: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    // Model sometimes outputs <tool> or <call> instead of <tool_call>
    const blockRegex = /<(?:tool_call|tool|call)>([\s\S]*?)<\/(?:tool_call|tool|call)>/g;

    let blockMatch;
    while ((blockMatch = blockRegex.exec(text)) !== null) {
      let content = blockMatch[1];
      let name = '';

      const nameMatch = content.match(/<name>(.*?)<\/name>/);
      if (nameMatch) {
        name = nameMatch[1].trim();
      } else {
        // Fallback: extract the first tag as the name, and use its content as the inner block
        const firstTagMatch = content.match(/<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1[^>]*>/);
        if (firstTagMatch && !['arguments', 'parameters', 'name'].includes(firstTagMatch[1])) {
          name = firstTagMatch[1].trim();
          content = firstTagMatch[2];
        }
      }

      if (name) {
        // Strip wrapper tags so they don't consume argument tags in the regex
        content = content.replace(/<\/?(?:arguments|parameters|name)[^>]*>/g, '');

        const args: Record<string, any> = {};

        // Match standard tags: <tag>content</tag> (robust to trailing characters in closing tag)
        const tagRegex = /<([a-zA-Z0-9_]+)[^>]*>([\s\S]*?)<\/\1[^>]*>/g;
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
          args[match[1]] = this.unescapeXML(match[2].trim());
        }

        // Match self-closing tags: <tag val="content" />
        const scRegex = /<([a-zA-Z0-9_]+)\s+[^>]*?(?:val|name|value)=["']([\s\S]*?)["'][^>]*?\/>/g;
        while ((match = scRegex.exec(content)) !== null) {
          args[match[1]] = this.unescapeXML(match[2]);
        }

        toolCalls.push({ name, args });
      }
    }
    return toolCalls;
  }

  private unescapeXML(text: string): string {
    return text.replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
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
    debugLog(`\n[DEBUG] --- Iteration 0 (System Prompt) ---`);
    debugLog(systemPrompt);

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
