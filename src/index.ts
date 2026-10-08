import 'dotenv/config';
import * as path from 'path';
import { TerminalUI } from './ui/TerminalUI';
import { TelegramUI } from './ui/TelegramUI';
import { createAgentFromEnv } from './harness/createAgent';
import { execTool } from './harness/tools/exec';
import { curlTool } from './harness/tools/curl';
import { weatherTool } from './harness/tools/weather';
import { loadSkills, createReadSkillTool } from './harness/skills';
import { loadMCPServers } from './harness/mcp/MCPLoader';
import { CommandRegistry, CommandContext } from './ui/CommandRegistry';

const systemMessage = (text: string) => `\x1b[33m[System]: ${text}\x1b[0m`;

function formatList(label: string, items: { name: string; description: string }[]): string {
  if (items.length === 0) return `\n${systemMessage(`No ${label} available.`)}`;
  return `\nAvailable ${label}:\n` + items.map(i => `  ${i.name.padEnd(20)} - ${i.description}\n`).join('');
}

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
    reply(systemMessage('Context cleared. Started a new session.'));
  }
});

registry.register({
  name: '/debug',
  description: 'Toggle debug logging for this conversation',
  execute: ({ agent, reply }) => {
    agent.debug = !agent.debug;
    reply(systemMessage(`Debug logging is now ${agent.debug ? 'ON' : 'OFF'}.`));
  }
});

registry.register({
  name: '/history',
  description: 'Show full conversation history',
  execute: ({ agent, reply }) => {
    const history = agent.getHistory();
    if (history.length === 0) {
      reply(`\n${systemMessage('History is empty.')}`);
      return;
    }
    const entries = history.map((msg, idx) => `\n--- Message ${idx + 1} (${msg.role}) ---\n${msg.content}\n`);
    reply(`\n${systemMessage('Full Conversation History:')}\n${entries.join('')}`);
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
    reply(formatList('skills', skills));
  }
});

registry.register({
  name: '/tools',
  description: 'Show available tools',
  execute: ({ tools, reply }) => {
    reply(formatList('tools', tools));
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
    reply(`\n${systemMessage(`Current context size is ${size}/${maxChars} characters (${percentage}%) across ${history.length} messages.`)}`);
  }
});

async function main() {
  // Fail fast on bad configuration (missing API key, unknown strategy) before loading skills and MCP servers.
  try {
    createAgentFromEnv();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
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

  const createAgent = () => createAgentFromEnv({ tools, skills });

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
    let telegramUI: TelegramUI;
    try {
      telegramUI = new TelegramUI(token, createAgent, registry, skills, tools);
    } catch (err: any) {
      console.error(`[System]: ${err.message}`);
      process.exit(1);
    }


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
