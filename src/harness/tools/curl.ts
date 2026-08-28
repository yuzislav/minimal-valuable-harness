import { Tool } from '../types';

export const curlTool: Tool = {
  name: 'curl',
  description: 'Make an HTTP request to a URL and return the response. Equivalent to the curl command.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to make a request to.'
      },
      method: {
        type: 'string',
        description: 'The HTTP method (e.g. GET, POST). Defaults to GET.'
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP headers as a key-value object.'
      },
      body: {
        type: 'string',
        description: 'Optional request body string for POST/PUT requests.'
      }
    },
    required: ['url']
  },
  async execute(args: Record<string, any>): Promise<any> {
    const url = args.url;
    if (!url) {
      throw new Error("Missing 'url' argument");
    }

    try {
      let headers = args.headers || {};
      if (typeof headers === 'string') {
        try { headers = JSON.parse(headers); } catch (e) {}
      }

      const options: RequestInit = {
        method: args.method || 'GET',
        headers: headers,
      };
      
      if (args.body) {
        options.body = args.body;
      }

      const response = await fetch(url, options);
      const text = await response.text();
      
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: text
      };
    } catch (e: any) {
      throw new Error(`HTTP Request failed: ${e.message}`);
    }
  }
};
