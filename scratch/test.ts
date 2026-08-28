import { OutputParser } from '../src/harness/parsers/OutputParser';
import { Agent } from '../src/harness/core/Agent';
import { weatherTool } from '../src/harness/tools/weather';

async function test() {
  const html = await weatherTool.execute({ cityName: 'Tokyo' });
  const parser = new OutputParser();
  const allText = `What is the weather forecast for Tokyo for the next 2 days?
<tool_call>
  <name>weather</name>
  <arguments>
    <cityName>Tokyo</cityName>
    <forecastDays>2</forecastDays>
  </arguments>
</tool_call>
Tool execution results:

Tool: weather
Result: ${html}
Based on the weather report...`;

  const calls = parser.parseToolCalls(allText);
  console.log("Parsed calls:", calls);
}
test();
