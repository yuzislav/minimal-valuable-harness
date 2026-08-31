import 'dotenv/config';
import * as path from 'path';
import { GeminiProvider } from './harness/providers/GeminiProvider';
import { LocalProvider } from './harness/providers/LocalProvider';
import { TerminalUI } from './ui/TerminalUI';
import { TelegramUI } from './ui/TelegramUI';
import { Agent } from './harness/core/Agent';
import { execTool } from './harness/tools/exec';
import { curlTool } from './harness/tools/curl';
import { weatherTool } from './harness/tools/weather';
import { loadSkills, createReadSkillTool } from './harness/skills';
import { loadMCPServers } from './harness/mcp/MCPLoader';
import { CommandRegistry, CommandContext } from './ui/CommandRegistry';
import * as fs from 'fs';
const registry = new CommandRegistry();

registry.register({
  name: '/exit',
  description: 'Exit the application',
  execute: () => true
});

registry.register({
  name: '/clear',
  description: 'Clear the agent context/history',
  execute: ({ agent, reply }) => {
    agent.clearHistory();
    reply('\x1b[33m[System]: Context cleared. Started a new session.\x1b[0m');
  }
});

registry.register({
  name: '/debug',
  description: 'Toggle debug logging',
  execute: ({ reply }) => {
    const isCurrentlyOn = process.env.DEBUG && process.env.DEBUG !== 'false';
    const newState = !isCurrentlyOn;
    process.env.DEBUG = newState ? 'true' : 'false';
    reply(`\x1b[33m[System]: Debug logging is now ${newState ? 'ON' : 'OFF'}.\x1b[0m`);
  }
});

registry.register({
  name: '/history',
  description: 'Show full conversation history',
  execute: ({ agent, reply }) => {
    const history = agent.getHistory();
    if (history.length === 0) {
      reply('\n\x1b[33m[System]: History is empty.\x1b[0m');
    } else {
      let output = '\n\x1b[33m[System]: Full Conversation History:\x1b[0m\n';
      history.forEach((msg: any, idx: number) => {
        output += `\n--- Message ${idx + 1} (${msg.role}) ---\n${msg.content}\n`;
      });
      reply(output);
    }
  }
});

registry.register({
  name: '/help',
  description: 'Show available commands',
  execute: ({ reply }) => {
    let output = '\nAvailable commands:\n';
    registry.getCommands().forEach(c => output += `  ${c.name.padEnd(10)} - ${c.description}\n`);
    reply(output);
  }
});

registry.register({
  name: '/skills',
  description: 'Show available skills',
  execute: ({ skills, reply }) => {
    if (skills.length === 0) {
      reply('\n\x1b[33m[System]: No skills available.\x1b[0m');
    } else {
      let output = '\nAvailable skills:\n';
      skills.forEach(s => output += `  ${s.name.padEnd(20)} - ${s.description}\n`);
      reply(output);
    }
  }
});

registry.register({
  name: '/tools',
  description: 'Show available tools',
  execute: ({ tools, reply }) => {
    if (tools.length === 0) {
      reply('\n\x1b[33m[System]: No tools available.\x1b[0m');
    } else {
      let output = '\nAvailable tools:\n';
      tools.forEach(t => output += `  ${t.name.padEnd(20)} - ${t.description}\n`);
      reply(output);
    }
  }
});

registry.register({
  name: '/context',
  description: 'Show current context size in characters',
  execute: ({ agent, reply }) => {
    const history = agent.getHistory();
    const size = history.reduce((sum, msg) => sum + msg.content.length, 0);
    const maxChars = agent.maxContextChars;
    const percentage = ((size / maxChars) * 100).toFixed(2);
    reply(`\n\x1b[33m[System]: Current context size is ${size}/${maxChars} characters (${percentage}%) across ${history.length} messages.\x1b[0m`);
  }
});

async function main() {
  const providerType = process.env.LLM_PROVIDER?.toLowerCase() || 'gemini';
  let provider: any;

  if (providerType === 'local') {
    provider = new LocalProvider();
    console.log('\x1b[33m[System] Initialized LocalProvider.\x1b[0m');
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Please set GEMINI_API_KEY in your environment or .env file to use Gemini (or set LLM_PROVIDER=local).");
      process.exit(1);
    }
    provider = new GeminiProvider(apiKey);
    console.log('\x1b[33m[System] Initialized GeminiProvider.\x1b[0m');
  }

  // Load skills from a 'skills' folder
  const skillsDir = path.join(__dirname, '..', 'skills');
  const skills = await loadSkills(skillsDir);

  // Define tools available to the Agent
  const tools = [
    execTool,
    curlTool,
    weatherTool,
    createReadSkillTool(skills)
  ];

  const activeMcpManagers = await loadMCPServers(tools);

  const createAgent = () => {
    let maxContextChars = 16000;
    if (providerType === 'local') {
      maxContextChars = parseInt(process.env.LOCAL_CONTEXT_LENGTH || '16000', 10);
    } else {
      maxContextChars = parseInt(process.env.GEMINI_CONTEXT_LENGTH || '2000000', 10);
    }

    const systemPromptTemplate = fs.readFileSync(path.join(__dirname, 'systemPrompt.md'), 'utf-8');

    return new Agent({
      provider,
      tools,
      skills,
      systemPrompt: systemPromptTemplate,
      maxIterations: 5,
      maxContextChars
    });
  };

  const args = process.argv.slice(2);
  let uiMode = 'terminal';
  const uiArgIndex = args.indexOf('--ui');
  if (uiArgIndex !== -1 && args.length > uiArgIndex + 1) {
    uiMode = args[uiArgIndex + 1];
  }

  if (uiMode === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("Please set TELEGRAM_BOT_TOKEN in your environment or .env file to use the Telegram UI.");
      process.exit(1);
    }
    const telegramUI = new TelegramUI(token, createAgent, registry, skills, tools);
    
    const shutdown = async () => {
      await telegramUI.stop();
      for (const manager of activeMcpManagers) {
        await manager.disconnect();
      }
      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } else {
    const agent = createAgent();
    
    const initialPromptArgs = args.filter(a => a !== '--ui' && a !== uiMode);
    const initialPrompt = initialPromptArgs.length > 0 ? initialPromptArgs[0] : undefined;
    
    if (initialPrompt && !initialPrompt.startsWith('--')) {
      console.log(`[User]: ${initialPrompt}\n`);
      const result = await agent.run(initialPrompt);
      console.log(`\n[Assistant]: ${result}`);
    }

    const terminal = new TerminalUI(registry.getCommands());
    const context: CommandContext = { agent, skills, tools, reply: console.log };

    while (true) {
      const userInput = await terminal.askQuestion('\n[User]: ');
      
      if (userInput.startsWith('/')) {
        const command = userInput.trim().toLowerCase();
        const shouldExit = await registry.process(command, context);
        if (shouldExit) break;
        continue;
      }

      if (!userInput.trim()) continue;

      const result = await agent.run(userInput);
      console.log(`\n[Assistant]: ${result}`);
    }

    terminal.close();

    for (const manager of activeMcpManagers) {
      await manager.disconnect();
    }
  }
}

main().catch(console.error);
