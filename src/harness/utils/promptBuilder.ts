import { Tool } from '../types';
import { Skill } from '../skills';

export function buildSystemPrompt(basePrompt: string, skills: Skill[], tools: Tool[]): string {
  let prompt = basePrompt || 'You are a helpful AI assistant.';

  if (skills.length > 0) {
    prompt += '\n\nAvailable Skills (use the read_skill tool to see full details):\n';
    for (const skill of skills) {
      prompt += `- ${skill.name}: ${skill.description}\n`;
    }
  }

  if (tools.length > 0) {
    prompt += '\n\nAvailable Tools:\n';
    for (const tool of tools) {
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
