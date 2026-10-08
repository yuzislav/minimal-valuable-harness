import { Agent, AgentConfig } from './core/Agent';
import { Provider } from './types';
import { GeminiProvider } from './providers/GeminiProvider';
import { LocalProvider } from './providers/LocalProvider';
import { OpenAiProvider } from './providers/OpenAiProvider';
import { execTool } from './tools/exec';
import { curlTool } from './tools/curl';
import { weatherTool } from './tools/weather';

type Env = Record<string, string | undefined>;

const isTrue = (value: string | undefined) => !!value && value.toLowerCase() !== 'false';

function intFromEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got '${raw}'.`);
  }
  return value;
}

// Context windows are measured in characters, not tokens. `<PROVIDER>_CONTEXT_CHARS` is the
// current name; `<PROVIDER>_CONTEXT_LENGTH` is still read for existing .env files.
function contextCharsFromEnv(env: Env, provider: string, fallback: number): number {
  const prefix = provider.toUpperCase();
  const name = env[`${prefix}_CONTEXT_CHARS`] !== undefined ? `${prefix}_CONTEXT_CHARS` : `${prefix}_CONTEXT_LENGTH`;
  return intFromEnv(env, name, fallback);
}

/** Create the LLM provider selected by `LLM_PROVIDER` (gemini by default). */
export function createProviderFromEnv(env: Env = process.env): Provider {
  switch (env.LLM_PROVIDER?.toLowerCase() || 'gemini') {
    case 'local':
      return new LocalProvider();
    case 'openai':
      return new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_BASE_URL);
    default:
      if (!env.GEMINI_API_KEY) {
        throw new Error('Please set GEMINI_API_KEY in your environment or .env file to use Gemini (or set LLM_PROVIDER=local).');
      }
      return new GeminiProvider(env.GEMINI_API_KEY);
  }
}

/**
 * Create an Agent configured from environment variables: LLM_PROVIDER, TOOL_FORMAT,
 * MAX_ITERATIONS, CONTEXT_STRATEGY, DEBUG, GEMINI_RPM_LIMIT and the per-provider
 * *_CONTEXT_CHARS. This is the only place that turns environment variables into agent
 * configuration; `overrides` win over anything read from `env`.
 * Without `tools` the agent gets the built-in exec, curl and weather tools.
 */
export function createAgentFromEnv(overrides: Partial<AgentConfig> = {}, env: Env = process.env): Agent {
  const providerType = env.LLM_PROVIDER?.toLowerCase() || 'gemini';
  const toolFormat = (env.TOOL_FORMAT || 'xml').toLowerCase();
  if (toolFormat !== 'xml' && toolFormat !== 'json') {
    throw new Error(`TOOL_FORMAT must be 'xml' or 'json', got '${env.TOOL_FORMAT}'.`);
  }

  const isGemini = providerType !== 'local' && providerType !== 'openai';
  const maxContextChars = providerType === 'local' ? contextCharsFromEnv(env, 'local', 16000)
    : providerType === 'openai' ? contextCharsFromEnv(env, 'openai', 128000)
    : contextCharsFromEnv(env, 'gemini', 2000000);

  return new Agent({
    tools: [execTool, curlTool, weatherTool],
    skills: [],
    toolFormat,
    maxIterations: intFromEnv(env, 'MAX_ITERATIONS', 5),
    maxContextChars,
    contextStrategy: (env.CONTEXT_STRATEGY?.toLowerCase() || 'cut_middle') as AgentConfig['contextStrategy'],
    rpmLimit: isGemini ? intFromEnv(env, 'GEMINI_RPM_LIMIT', 0) : 0,
    debug: isTrue(env.DEBUG),
    ...overrides,
    provider: overrides.provider ?? createProviderFromEnv(env),
  });
}
