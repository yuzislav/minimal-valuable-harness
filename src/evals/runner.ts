import { Agent } from '../harness/core/Agent';
import { EvalSuite, EvalContext, EvalResult } from './types';
import { OutputParser } from '../harness/parsers/OutputParser';

export async function runEvalSuite(suite: EvalSuite, agentFactory: () => Agent): Promise<number> {
  console.log(`\n\x1b[36mRunning Test Suite: ${suite.name}\x1b[0m`);
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;
  const parser = new OutputParser();

  for (const testCase of suite.cases) {
    console.log(`\nRunning case: \x1b[33m${testCase.name}\x1b[0m`);
    const agent = agentFactory();
    try {
      const response = await agent.run(testCase.input);
      
      // Parse tool calls from all assistant messages
      const history = agent.getHistory();
      const toolCalls = history
        .filter(m => m.role === 'assistant')
        .flatMap(m => parser.parseToolCalls(m.content));
        
      const context: EvalContext = { response, agent, toolCalls };
      
      const result = await testCase.assert(context);
      const isPassed = typeof result === 'boolean' ? result : result.passed;
      const errorMsg = typeof result === 'boolean' ? undefined : result.error;

      if (isPassed) {
        console.log(`\x1b[32m  ✓ PASSED\x1b[0m`);
        passed++;
      } else {
        console.log(`\x1b[31m  ✗ FAILED\x1b[0m${errorMsg ? ` - ${errorMsg}` : ''}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`\x1b[31m  ✗ ERROR\x1b[0m - Execution threw: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\x1b[36mSuite '${suite.name}' Results:\x1b[0m`);
  console.log(`Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed: \x1b[31m${failed}\x1b[0m`);
  console.log(`Total:  ${passed + failed}`);
  console.log('='.repeat(50));
  
  return failed;
}
