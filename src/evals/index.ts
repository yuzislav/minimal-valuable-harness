import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import { runEvalSuite } from './runner';
import { toolsEvalSuite } from './cases/tools.eval';
import { skillsEvalSuite } from './cases/skills.eval';
import { shopMcpEvalSuite } from './cases/shop-mcp.eval';
import { Agent } from '../harness/core/Agent';
import { GeminiProvider } from '../harness/providers/GeminiProvider';
import { LocalProvider } from '../harness/providers/LocalProvider';
import { execTool } from '../harness/tools/exec';
import { curlTool } from '../harness/tools/curl';
import { weatherTool } from '../harness/tools/weather';
import { loadSkills, createReadSkillTool } from '../harness/skills';
import { loadMCPServers } from '../harness/mcp/MCPLoader';

// Optional CLI flag: --suite <name>  (e.g. --suite shop)
// Without the flag, all suites are run.
const suiteArg = (() => {
  const idx = process.argv.indexOf('--suite');
  return idx !== -1 ? process.argv[idx + 1]?.toLowerCase() : undefined;
})();

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
        super(apiKey as string);
      }
    };
  }

  // Load skills
  const skillsDir = path.join(__dirname, '..', '..', 'skills');
  const skills = await loadSkills(skillsDir);
  const readSkillTool = createReadSkillTool(skills);

  // Base tools (without MCP)
  const baseTools = [execTool, curlTool, weatherTool, readSkillTool];

  // Load MCP servers (needed for shop-mcp evals)
  const mcpManagers = await loadMCPServers(baseTools);

  // Same config as src/index.ts — evals must test the real agent, not a tuned one
  const createAgent = () =>
    new Agent({
      provider: new ProviderClass(),
      tools: [...baseTools],
      skills,
      systemPrompt: 'You are a helpful and educational AI assistant running in a minimal harness. Make use of your available tools.',
      maxIterations: 10,
      maxContextChars: 1000000,
    });

  // Suite registry — add new suites here
  const allSuites: Array<{ name: string; run: () => Promise<number> }> = [
    { name: 'tools',  run: () => runEvalSuite(toolsEvalSuite,   createAgent) },
    { name: 'skills', run: () => runEvalSuite(skillsEvalSuite,  createAgent) },
    { name: 'shop',   run: () => runEvalSuite(shopMcpEvalSuite, createAgent) },
  ];

  const suitesToRun = suiteArg
    ? allSuites.filter(s => s.name === suiteArg)
    : allSuites;

  if (suiteArg && suitesToRun.length === 0) {
    console.error(`\x1b[31mUnknown suite: "${suiteArg}". Available: ${allSuites.map(s => s.name).join(', ')}\x1b[0m`);
    process.exit(1);
  }

  let totalFailures = 0;
  for (const suite of suitesToRun) {
    totalFailures += await suite.run();
  }

  // Cleanup MCP connections
  for (const manager of mcpManagers) {
    await manager.disconnect();
  }

  if (totalFailures > 0) {
    console.log(`\n\x1b[31mEval execution failed with ${totalFailures} total failed tests.\x1b[0m`);
    process.exit(1);
  }
}

runAllEvals().catch(err => {
  console.error("Eval execution failed:", err);
  process.exit(1);
});
