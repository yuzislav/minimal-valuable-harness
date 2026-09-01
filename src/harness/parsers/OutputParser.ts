import { ToolCall } from '../types';

export interface ParseResult {
  calls: ToolCall[];
  errors: string[];
}

export interface IOutputParser {
  parseToolCalls(text: string): ParseResult;
}

export class OutputParser implements IOutputParser {
  /**
   * Extracts tool calls from the LLM's raw text response.
   * Validates against the expected schema and returns meaningful errors if invalid.
   */
  public parseToolCalls(text: string): ParseResult {
    const calls: ToolCall[] = [];
    const errors: string[] = [];

    // Catch old/invalid tags
    const oldBlockRegex = /<(tool|call)>[\s\S]*?<\/\1>/g;
    if (oldBlockRegex.test(text)) {
      errors.push("Invalid tool call tag. Use <tool_call> instead of <tool> or <call>.");
    }

    const blockRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(text)) !== null) {
      const content = blockMatch[1];
      const nameMatch = content.match(/<name>([\s\S]*?)<\/name>/);
      const argsMatch = content.match(/<arguments>([\s\S]*?)<\/arguments>/);

      if (!nameMatch) {
        errors.push("Missing or invalid <name> tag inside <tool_call>. Expected format:\n<tool_call>\n  <name>tool_name</name>\n  <arguments>...</arguments>\n</tool_call>");
        continue;
      }

      const name = nameMatch[1].trim();
      if (!name) {
        errors.push("The <name> tag is empty inside <tool_call>.");
        continue;
      }

      const args: Record<string, any> = {};

      if (argsMatch) {
        const argsContent = argsMatch[1];
        const tagRegex = /<([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/\1>/g;
        let match;
        let parsedAny = false;
        
        while ((match = tagRegex.exec(argsContent)) !== null) {
          parsedAny = true;
          const argName = match[1];
          const argValue = match[2].trim();
          
          if (/<[a-zA-Z0-9_\-]+>/.test(argValue)) {
            errors.push(`Argument <${argName}> contains nested XML tags. Complex types like objects or arrays must be passed as JSON-encoded strings, not nested XML tags.`);
          }

          if ((argValue.startsWith('{') && argValue.endsWith('}')) || (argValue.startsWith('[') && argValue.endsWith(']'))) {
            try {
              JSON.parse(argValue);
            } catch (e: any) {
              errors.push(`Argument <${argName}> looks like JSON but is invalid. Ensure it is a properly escaped JSON string. Error: ${e.message}`);
            }
          }

          args[argName] = this.unescapeXML(argValue);
        }

        if (!parsedAny && argsContent.trim().length > 0) {
          errors.push(`Invalid arguments format for tool '${name}'. Expected <parameter_name>parameter_value</parameter_name> inside <arguments>.`);
          continue;
        }
      }

      calls.push({ name, args });
    }

    // Catch unclosed or completely malformed tool calls that failed to match the blockRegex
    const openTags = (text.match(/<tool_call>/g) || []).length;
    const closeTags = (text.match(/<\/tool_call>/g) || []).length;
    if (openTags !== closeTags) {
      errors.push("Found unclosed or mismatched <tool_call> tags. Please ensure every <tool_call> is properly closed with </tool_call>.");
    } else if (openTags > 0 && calls.length === 0 && errors.length === 0) {
      errors.push("Found <tool_call> tag but failed to parse it. Ensure it follows the expected schema with <name> and <arguments>.");
    }

    return { calls, errors };
  }

  private unescapeXML(text: string): string {
    return text.replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }
}
