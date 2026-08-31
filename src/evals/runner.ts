import { Agent } from '../harness/core/Agent';
import { EvalSuite, EvalContext, EvalResult } from './types';
import { OutputParser } from '../harness/parsers/OutputParser';

export interface SuiteResult {
  suiteName: string;
  passed: number;
  failed: number;
  failures: Array<{ testName: string; errorMsg?: string }>;
}

export async function runEvalSuite(suite: EvalSuite, agentFactory: () => Agent): Promise<SuiteResult> {
  console.log(`\n\x1b[36mRunning Test Suite: ${suite.name}\x1b[0m`);
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;
  const failures: Array<{ testName: string; errorMsg?: string }> = [];
  const parser = new OutputParser();

  for (const testCase of suite.cases) {
    console.log(`\nRunning case: \x1b[33m${testCase.name}\x1b[0m`);
    const agent = agentFactory();
    try {
      const response = await agent.run(testCase.input);

      // Parse tool calls and get exact LLM iterations from agent (handles history compaction)
      const history = agent.getHistory();
      const llmIterations = agent.lastRunIterations;
      const toolCalls = history
        .filter(m => m.role === 'assistant')
        .flatMap(m => parser.parseToolCalls(m.content).calls);

      const context: EvalContext = { response, agent, toolCalls };

      const result = await testCase.assert(context);
      const isPassed = typeof result === 'boolean' ? result : result.passed;
      const errorMsg = typeof result === 'boolean' ? undefined : result.error;

      if (isPassed) {
        console.log(`\x1b[32m  ✓ PASSED\x1b[0m \x1b[90m(${llmIterations} LLM call${llmIterations !== 1 ? 's' : ''})\x1b[0m`);
        passed++;
      } else {
        console.log(`\x1b[31m  ✗ FAILED\x1b[0m \x1b[90m(${llmIterations} LLM call${llmIterations !== 1 ? 's' : ''})\x1b[0m${errorMsg ? ` - ${errorMsg}` : ''}`);
        console.log(`    \x1b[90mRequest:\x1b[0m ${testCase.input}`);
        console.log(`    \x1b[90mResponse:\x1b[0m ${response}`);
        failed++;
        failures.push({ testName: testCase.name, errorMsg });
      }
    } catch (err: any) {
      console.log(`\x1b[31m  ✗ ERROR\x1b[0m - Execution threw: ${err.message}`);
      failed++;
      failures.push({ testName: testCase.name, errorMsg: err.message });
    }

    // Wait based on RPM limit between cases to avoid rate limits
    // Skip wait for local models which don't have rate limits
    if (testCase !== suite.cases[suite.cases.length - 1] && process.env.LLM_PROVIDER?.toLowerCase() !== 'local') {
      const rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '15', 10);
      const waitMs = rpmLimit > 0 ? Math.ceil(60000 / rpmLimit) : 0;
      if (waitMs > 0) {
        console.log(`\x1b[90m  Waiting ${waitMs}ms to respect ${rpmLimit} RPM limit...\x1b[0m`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\x1b[36mSuite '${suite.name}' Results:\x1b[0m`);
  console.log(`Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed: \x1b[31m${failed}\x1b[0m`);
  console.log(`Total:  ${passed + failed}`);
  console.log('='.repeat(50));

  return { suiteName: suite.name, passed, failed, failures };
}
