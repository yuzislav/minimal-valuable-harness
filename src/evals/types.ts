import { Agent } from '../harness/core/Agent';
import { ToolCall } from '../harness/types';

export interface EvalResult {
  passed: boolean;
  error?: string;
}

export interface EvalContext {
  response: string;
  agent: Agent;
  toolCalls: ToolCall[];
}

export interface EvalTestCase {
  name: string;
  input: string;
  assert: (context: EvalContext) => boolean | Promise<boolean> | EvalResult | Promise<EvalResult>;
}

export interface EvalSuite {
  name: string;
  cases: EvalTestCase[];
}
