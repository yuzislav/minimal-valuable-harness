import { toolsEvalSuite } from '../src/evals/cases/tools.eval';

const testCase = toolsEvalSuite.cases.find(c => c.name === 'Weather Tool Check - Tokyo 2 Days');
if (!testCase) throw new Error("not found");

const res = testCase.assert({
  response: "Based on the weather report for Tokyo...",
  toolCalls: [ { name: 'weather', args: { cityName: 'Tokyo', forecastDays: '2' } } ]
});
console.log(res);
