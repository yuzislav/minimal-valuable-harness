import { z } from 'zod';
import { ToolCall } from '../types';
import { ParseResult, IOutputParser } from './OutputParser';

const ToolCallSchema = z.array(
  z.object({
    name: z.string({ required_error: "Missing 'name' property", invalid_type_error: "'name' must be a string" }),
    arguments: z.record(z.any()).optional().default({}),
    args: z.record(z.any()).optional()
  }).transform(val => ({
    name: val.name,
    args: val.arguments || val.args || {}
  }))
);

export class JsonOutputParser implements IOutputParser {
  public parseToolCalls(text: string): ParseResult {
    const calls: ToolCall[] = [];
    const errors: string[] = [];

    let jsonStr = text.trim();
    
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    } else {
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        jsonStr = text.substring(firstBracket, lastBracket + 1);
      } else {
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = text.substring(firstBrace, lastBrace + 1);
        } else {
          jsonStr = '';
        }
      }
    }

    if (!jsonStr) {
      return { calls, errors };
    }

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(jsonStr);
      if (!Array.isArray(parsedJson)) {
        parsedJson = [parsedJson];
      }
    } catch (e: any) {
      if (jsonStr.startsWith('{') || jsonStr.startsWith('[')) {
        errors.push(`Failed to parse JSON. Error: ${e.message}\nEnsure your response contains a valid JSON array of tool calls.`);
      }
      return { calls, errors };
    }

    const validationResult = ToolCallSchema.safeParse(parsedJson);

    if (!validationResult.success) {
      for (const issue of validationResult.error.issues) {
        const path = issue.path.join('.');
        errors.push(`Validation error at '${path}': ${issue.message}`);
      }
    } else {
      calls.push(...validationResult.data);
    }

    return { calls, errors };
  }
}
