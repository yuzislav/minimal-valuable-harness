import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { runEvalSuite } from './runner';
import { toolsEvalSuite } from './cases/tools.eval';
import { skillsEvalSuite } from './cases/skills.eval';
import { shopMcpEvalSuite } from './cases/shop-mcp.eval';
import { Agent } from '../harness/core/Agent';
import { GeminiProvider } from '../harness/providers/GeminiProvider';
import { LocalProvider } from '../harness/providers/LocalProvider';
import { OpenAiProvider } from '../harness/providers/OpenAiProvider';
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
  } else if (providerType === 'openai') {
    ProviderClass = class extends OpenAiProvider {
      constructor() {
        super(
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_MODEL,
          process.env.OPENAI_BASE_URL
        );
      }
    };
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

  const tools = [
    execTool,
    curlTool,
    weatherTool,
    createReadSkillTool(skills)
  ];

  const toolFormat = (process.env.TOOL_FORMAT || 'xml') as 'xml' | 'json';
  const systemPromptFile = toolFormat === 'json' ? 'systemPrompt.json.md' : 'systemPrompt.xml.md';
  const systemPromptTemplate = fs.readFileSync(path.join(__dirname, '..', systemPromptFile), 'utf-8');

  // We must bind createAgent this way so evals can create isolated agents per-test
  const createAgent = () => new Agent({
    provider: new ProviderClass(),
    tools: [...baseTools],
    skills,
    systemPrompt: systemPromptTemplate,
    toolFormat,
    maxContextChars: 1000000,
  });

  // Suite registry — add new suites here
  const allSuites: Array<{ name: string; run: () => Promise<any> }> = [
    { name: 'tools', run: () => runEvalSuite(toolsEvalSuite, createAgent) },
    { name: 'skills', run: () => runEvalSuite(skillsEvalSuite, createAgent) },
    { name: 'shop', run: () => runEvalSuite(shopMcpEvalSuite, createAgent) },
  ];

  const suitesToRun = suiteArg
    ? allSuites.filter(s => s.name === suiteArg)
    : allSuites;

  if (suiteArg && suitesToRun.length === 0) {
    console.error(`\x1b[31mUnknown suite: "${suiteArg}". Available: ${allSuites.map(s => s.name).join(', ')}\x1b[0m`);
    process.exit(1);
  }

  const allSuiteResults = [];
  let totalFailures = 0;
  for (const suite of suitesToRun) {
    const result = await suite.run();
    allSuiteResults.push(result);
    totalFailures += result.failed;
  }

  // Cleanup MCP connections
  for (const manager of mcpManagers) {
    await manager.disconnect();
  }

  // Print Summary
  console.log('\n' + '='.repeat(60));
  console.log('\x1b[36m                   EVALUATION SUMMARY\x1b[0m');
  console.log('='.repeat(60));
  for (const res of allSuiteResults) {
    const total = res.passed + res.failed;
    console.log(`\x1b[1mSuite: ${res.suiteName}\x1b[0m - \x1b[32m${res.passed} passed\x1b[0m, \x1b[31m${res.failed} failed\x1b[0m (Total: ${total})`);
    for (const failure of res.failures) {
      console.log(`  \x1b[31m✗\x1b[0m ${failure.testName}${failure.errorMsg ? `\n    \x1b[90mError:\x1b[0m ${failure.errorMsg}` : ''}`);
    }
    if (res.failures.length > 0) console.log();
  }
  console.log('='.repeat(60));

  if (totalFailures > 0) {
    console.log(`\n\x1b[31mEval execution failed with ${totalFailures} total failed tests.\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32mAll evaluations passed successfully!\x1b[0m`);
    process.exit(0);
  }
}

runAllEvals().catch(err => {
  console.error("Eval execution failed:", err);
  process.exit(1);
});
