import { ToolCall } from './types';

export class OutputParser {
  /**
   * Extracts tool calls from the LLM's raw text response.
   */
  public parseToolCalls(text: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const blockRegex = /<(?:tool_call|tool|call)>([\s\S]*?)<\/(?:tool_call|tool|call)>/g;

    let blockMatch;
    while ((blockMatch = blockRegex.exec(text)) !== null) {
      let content = blockMatch[1];
      let name = '';

      const nameMatch = content.match(/<name>(.*?)<\/name>/);
      if (nameMatch) {
        name = nameMatch[1].trim();
      } else {
        const firstTagMatch = content.match(/<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1[^>]*>/);
        if (firstTagMatch && !['arguments', 'parameters', 'name'].includes(firstTagMatch[1])) {
          name = firstTagMatch[1].trim();
          content = firstTagMatch[2];
        }
      }

      if (name) {
        content = content.replace(/<\/?(?:arguments|parameters|name)[^>]*>/g, '');

        const args: Record<string, any> = {};

        const tagRegex = /<([a-zA-Z0-9_]+)[^>]*>([\s\S]*?)<\/\1[^>]*>/g;
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
          args[match[1]] = this.unescapeXML(match[2].trim());
        }

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
}
