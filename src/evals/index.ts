import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import { runEvalSuite } from './runner';
import { toolsEvalSuite } from './cases/tools.eval';
import { skillsEvalSuite } from './cases/skills.eval';
import { Agent } from '../harness/core/Agent';
import { GeminiProvider } from '../harness/providers/GeminiProvider';
import { LocalProvider } from '../harness/providers/LocalProvider';
import { execTool } from '../harness/tools/exec';
import { curlTool } from '../harness/tools/curl';
import { weatherTool } from '../harness/tools/weather';
import { loadSkills, createReadSkillTool } from '../harness/skills';

async function runAllEvals() {
  const providerType = process.env.LLM_PROVIDER?.toLowerCase() || 'gemini';
  let ProviderClass: any;

  if (providerType === 'local') {
    ProviderClass = LocalProvider;
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Please set GEMINI_API_KEY in your environment or .env file to run evals with Gemini.");
      process.exit(1);
    }
    ProviderClass = class extends GeminiProvider {
      constructor() {
        super(apiKey);
      }
    };
  }

  // Load skills
  const skillsDir = path.join(__dirname, '..', '..', 'skills');
  const skills = await loadSkills(skillsDir);
  const readSkillTool = createReadSkillTool(skills);

  // Factory function to create a clean agent for each test
  const createAgent = () => {
    return new Agent({
      provider: new ProviderClass(),
      tools: [execTool, curlTool, weatherTool, readSkillTool],
      skills: skills,
      systemPrompt: 'You are a helpful AI assistant. Always try to use the appropriate tools to answer the user.',
      maxIterations: 5,
      maxContextChars: 1000000,
    });
  };

  // Run the suites
  let totalFailures = 0;
  totalFailures += await runEvalSuite(toolsEvalSuite, createAgent);
  totalFailures += await runEvalSuite(skillsEvalSuite, createAgent);
  
  if (totalFailures > 0) {
    console.log(`\n\x1b[31mEval execution failed with ${totalFailures} total failed tests.\x1b[0m`);
    process.exit(1);
  }
}

runAllEvals().catch(err => {
  console.error("Eval execution failed:", err);
  process.exit(1);
});
