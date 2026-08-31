import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { Tool } from '../types';

export interface Skill {
  name: string;
  description: string;
  content: string;
}

function parseFrontmatter(content: string): any {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return yaml.parse(match[1]);
}

export async function loadSkills(skillsDir: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  if (!existsSync(skillsDir)) {
    return skills;
  }

  const files = await fs.readdir(skillsDir);
  const mdFiles = files.filter(f => f.endsWith('.md'));

  for (const file of mdFiles) {
    const filePath = path.join(skillsDir, file);
    const content = await fs.readFile(filePath, 'utf-8');

    try {
      const frontmatter = parseFrontmatter(content);
      if (frontmatter && frontmatter.name && frontmatter.description) {
        skills.push({
          name: frontmatter.name,
          description: frontmatter.description,
          content: content.replace(/^---\n[\s\S]*?\n---\n*/, '')
        });
      }
    } catch (e) {
      console.error(`Error parsing frontmatter in ${file}:`, e);
    }
  }
  return skills;
}

export function createReadSkillTool(skills: Skill[]): Tool {
  return {
    name: 'read_skill',
    description: 'Reads the full content of a specified skill file to inject it into the context.',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'The name of the skill to read (e.g. from the available skills list)'
        }
      },
      required: ['skill_name']
    },
    async execute(args: Record<string, any>) {
      const skillName = args.skill_name;
      const skill = skills.find(s => s.name === skillName);
      if (!skill) {
        throw new Error(`Skill '${skillName}' not found.`);
      }
      return {
        content: skill.content
      };
    }
  };
}
