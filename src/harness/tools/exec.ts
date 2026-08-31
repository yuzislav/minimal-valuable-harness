import * as vm from 'vm';
import { Tool } from '../types';

export const execTool: Tool = {
  name: 'exec',
  description: 'Executes JavaScript code in a protected Node.js VM sandbox environment. Use this to run code or calculations. Returns the script result and console logs.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JavaScript code to execute. Can contain console.log.'
      }
    },
    required: ['code']
  },
  async execute(args: Record<string, any>): Promise<any> {
    const code = args.code;
    if (!code) {
      throw new Error("Missing 'code' argument");
    }

    const logs: string[] = [];
    const sandbox = {
      console: {
        log: (...msgs: any[]) => logs.push(msgs.map(m => String(m)).join(' ')),
        error: (...msgs: any[]) => logs.push('ERROR: ' + msgs.map(m => String(m)).join(' ')),
      }
    };

    // create the sandboxed execution context
    vm.createContext(sandbox);

    try {
      const result = vm.runInContext(code, sandbox, { timeout: 2000 });
      return {
        result,
        logs
      };
    } catch (e: any) {
      throw new Error(`Execution error: ${e.message}`);
    }
  }
};
