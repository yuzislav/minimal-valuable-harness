export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface Tool {
  name: string;
  description: string;
  // JSON Schema-like representation of parameters for the LLM prompt
  parameters: any;
  execute: (args: Record<string, any>) => Promise<any>;
}

export interface Provider {
  /**
   * Generates a raw text response from the LLM based on the conversation history.
   * In this minimal harness, the LLM will output tool calls as JSON codeblocks,
   * which the Agent will parse.
   */
  generate(messages: Message[], systemPrompt?: string): Promise<string>;
}
