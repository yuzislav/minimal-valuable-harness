import { EvalSuite } from '../types';

export const toolsEvalSuite: EvalSuite = {
  name: 'Tools Evaluation Suite',
  cases: [
    // --- WEATHER TOOL TESTS ---
    {
      name: 'Weather Tool Check - Paris',
      input: 'What is the weather in Paris?',
      assert: ({ response, toolCalls }) => {
        const weatherCall = toolCalls.find(call => call.name === 'weather');
        if (!weatherCall) return { passed: false, error: 'Weather tool was not called' };
        if (!weatherCall.args.cityName?.toLowerCase().includes('paris')) {
          return { passed: false, error: `Wrong city: ${weatherCall.args.cityName}` };
        }
        if (!response.toLowerCase().includes('paris')) return { passed: false, error: 'Response does not mention Paris' };
        return { passed: true };
      }
    },
    {
      name: 'Weather Tool Check - Tokyo 2 Days',
      input: 'What is the weather forecast for Tokyo for the next 2 days?',
      assert: ({ toolCalls }) => {
        const weatherCall = toolCalls.find(call => call.name === 'weather');
        if (!weatherCall) return { passed: false, error: 'Weather tool was not called' };
        if (!weatherCall.args.cityName?.toLowerCase().includes('tokyo')) {
          return { passed: false, error: `Wrong city: ${weatherCall.args.cityName}` };
        }
        if (Number(weatherCall.args.forecastDays) !== 2) {
          return { passed: false, error: `Wrong forecastDays: ${weatherCall.args.forecastDays}` };
        }
        return { passed: true };
      }
    },
    {
      name: 'Weather Tool Check - Multiple Cities',
      input: 'Is it hotter in Rome or Madrid right now?',
      assert: ({ toolCalls }) => {
        const weatherCalls = toolCalls.filter(call => call.name === 'weather');
        if (weatherCalls.length < 2) return { passed: false, error: 'Weather tool was not called multiple times' };
        
        const cities = weatherCalls.map(c => c.args.cityName?.toLowerCase() || '');
        if (!cities.some(c => c.includes('rome')) || !cities.some(c => c.includes('madrid'))) {
          return { passed: false, error: `Did not check both Rome and Madrid. Cities checked: ${cities.join(', ')}` };
        }
        return { passed: true };
      }
    },

    // --- EXEC TOOL TESTS ---
    {
      name: 'Exec Tool Check - Hello World',
      input: 'Execute javascript to print Hello World',
      assert: ({ response, toolCalls }) => {
        const execCall = toolCalls.find(call => call.name === 'exec');
        if (!execCall) return { passed: false, error: 'Exec tool was not called' };
        if (!execCall.args.code?.includes('Hello World')) {
          return { passed: false, error: `Exec tool called with wrong code: ${execCall.args.code}` };
        }
        if (!response.toLowerCase().includes('hello world')) return { passed: false, error: 'Response does not contain Hello World' };
        return { passed: true };
      }
    },
    {
      name: 'Exec Tool Check - Math',
      input: 'Use javascript to calculate 12345 multiplied by 67890',
      assert: ({ response, toolCalls }) => {
        const execCall = toolCalls.find(call => call.name === 'exec');
        if (!execCall) return { passed: false, error: 'Exec tool was not called' };
        
        const answer = (12345 * 67890).toString();
        if (!response.replace(/,/g, '').includes(answer)) {
          return { passed: false, error: `Response does not contain the correct answer: ${answer}` };
        }
        return { passed: true };
      }
    },
    {
      name: 'Exec Tool Check - Date',
      input: 'Use javascript to tell me what year it is. Return ONLY the year.',
      assert: ({ response, toolCalls }) => {
        const execCall = toolCalls.find(call => call.name === 'exec');
        if (!execCall) return { passed: false, error: 'Exec tool was not called' };
        
        const currentYear = new Date().getFullYear().toString();
        if (!response.includes(currentYear)) {
          return { passed: false, error: `Response does not contain current year ${currentYear}` };
        }
        return { passed: true };
      }
    },

    // --- CURL TOOL TESTS ---
    {
      name: 'Curl Tool Check - GET',
      input: 'Make a GET request to https://httpbin.org/get and tell me the value of the "url" field in the response',
      assert: ({ response, toolCalls }) => {
        const curlCall = toolCalls.find(call => call.name === 'curl');
        if (!curlCall) return { passed: false, error: 'Curl tool was not called' };
        if (!curlCall.args.url?.includes('httpbin.org/get')) {
          return { passed: false, error: `Wrong URL: ${curlCall.args.url}` };
        }
        
        if (!response.includes('https://httpbin.org/get')) {
          return { passed: false, error: 'Response does not contain the extracted url field' };
        }
        return { passed: true };
      }
    },
    {
      name: 'Curl Tool Check - POST',
      input: 'Make a POST request to https://httpbin.org/post with a JSON body {"agent": "test"}. What is the data field in the response?',
      assert: ({ response, toolCalls }) => {
        const curlCall = toolCalls.find(call => call.name === 'curl');
        if (!curlCall) return { passed: false, error: 'Curl tool was not called' };
        if (curlCall.args.method !== 'POST') return { passed: false, error: `Wrong method: ${curlCall.args.method}` };
        if (!curlCall.args.body?.includes('test')) return { passed: false, error: `Wrong body: ${curlCall.args.body}` };
        
        if (!response.includes('test')) {
          return { passed: false, error: 'Response does not contain the expected data' };
        }
        return { passed: true };
      }
    },
    {
      name: 'Curl Tool Check - Headers',
      input: 'Make a GET request to https://httpbin.org/headers and pass a custom header "X-My-Header: Hello". What headers does it return?',
      assert: ({ response, toolCalls }) => {
        const curlCall = toolCalls.find(call => call.name === 'curl');
        if (!curlCall) return { passed: false, error: 'Curl tool was not called' };
        
        let headers = curlCall.args.headers || {};
        if (typeof headers === 'string') {
          try {
            headers = JSON.parse(headers);
          } catch (e) {
            // keep it as string if parsing fails, but check it
          }
        }
        
        let headerKeys: string[] = [];
        if (typeof headers === 'object' && !Array.isArray(headers)) {
          headerKeys = Object.keys(headers).map(k => k.toLowerCase());
        } else if (typeof headers === 'string') {
          headerKeys = [headers.toLowerCase()];
        } else if (Array.isArray(headers)) {
          // If the LLM returned an array like [["X-My-Header", "Hello"]]
          headerKeys = headers.map(h => (Array.isArray(h) ? h[0] : JSON.stringify(h)).toLowerCase());
        }
        
        if (!headerKeys.some(k => k.includes('x-my-header'))) {
          return { passed: false, error: `Custom header not passed. Headers: ${JSON.stringify(curlCall.args.headers)}` };
        }
        
        if (!response.toLowerCase().includes('hello')) {
          return { passed: false, error: 'Response does not mention the header value' };
        }
        return { passed: true };
      }
    }
  ]
};
