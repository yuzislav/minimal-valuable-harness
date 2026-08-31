import { Tool } from '../types';
import { Skill } from '../skills';

export function buildSystemPrompt(basePrompt: string, skills: Skill[], tools: Tool[], toolFormat: 'xml' | 'json' = 'xml'): string {
  let prompt = basePrompt || 'You are a helpful AI assistant.\n\nCurrent Date: {current_date}\n\n{available_skills}\n\n{available_tools}';

  let skillsList = '';
  if (skills.length > 0) {
    for (const skill of skills) {
      skillsList += `- ${skill.name}: ${skill.description}\n`;
    }
  }

  let toolsList = '';
  if (tools.length > 0) {
    if (toolFormat === 'json') {
      const jsonTools = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
      toolsList = JSON.stringify(jsonTools, null, 2);
    } else {
      for (const tool of tools) {
        toolsList += `<tool>\n`;
        toolsList += `  <name>${tool.name}</name>\n`;
        toolsList += `  <description>${tool.description}</description>\n`;
        toolsList += `  <parameters>\n`;
        if (tool.parameters && tool.parameters.properties) {
          for (const [key, prop] of Object.entries(tool.parameters.properties)) {
            const type = (prop as any).type || 'string';
            const desc = (prop as any).description || '';
            toolsList += `    <parameter name="${key}" type="${type}">${desc}</parameter>\n`;
          }
        }
        toolsList += `  </parameters>\n`;
        toolsList += `</tool>\n`;
      }
    }
  }

  prompt = prompt.replace('{current_date}', new Date().toISOString());
  prompt = prompt.replace('{available_skills}', skillsList.trim());
  prompt = prompt.replace('{available_tools}', toolsList.trim());

  return prompt;
}
