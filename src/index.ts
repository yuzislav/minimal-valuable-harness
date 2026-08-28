import 'dotenv/config';
import * as path from 'path';
import { GeminiProvider } from './harness/providers/GeminiProvider';
import { LocalProvider } from './harness/providers/LocalProvider';
import { TerminalUI } from './ui/TerminalUI';
import { Agent } from './harness/Agent';
import { execTool } from './harness/tools/exec';
import { curlTool } from './harness/tools/curl';
import { weatherTool } from './harness/tools/weather';
import { loadSkills, createReadSkillTool } from './harness/skills';
import { loadMCPServers } from './harness/MCPLoader';
import { CommandRegistry, CommandContext } from './ui/CLI';

const registry = new CommandRegistry();

registry.register({
  name: '/exit',
  description: 'Exit the application',
  execute: () => true
});

registry.register({
  name: '/quit',
  description: 'Exit the application',
  execute: () => true
});

registry.register({
  name: '/clear',
  description: 'Clear the agent context/history',
  execute: ({ agent }) => {
    agent.clearHistory();
    console.log('[System]: Context cleared. Started a new session.');
  }
});

registry.register({
  name: '/debug',
  description: 'Toggle debug logging',
  execute: () => {
    process.env.DEBUG = process.env.DEBUG ? '' : 'true';
    console.log(`[System]: Debug logging is now ${process.env.DEBUG ? 'ON' : 'OFF'}.`);
  }
});

registry.register({
  name: '/history',
  description: 'Show full conversation history',
  execute: ({ agent }) => {
    const history = agent.getHistory();
    if (history.length === 0) {
      console.log('\n[System]: History is empty.');
    } else {
      console.log('\n[System]: Full Conversation History:');
      history.forEach((msg, idx) => {
        console.log(`\n--- Message ${idx + 1} (${msg.role}) ---`);
        console.log(msg.content);
      });
    }
  }
});

registry.register({
  name: '/help',
  description: 'Show available commands',
  execute: () => {
    console.log('\nAvailable commands:');
    registry.getCommands().forEach(c => console.log(`  ${c.name.padEnd(10)} - ${c.description}`));
  }
});

registry.register({
  name: '/skills',
  description: 'Show available skills',
  execute: ({ skills }) => {
    if (skills.length === 0) {
      console.log('\n[System]: No skills available.');
    } else {
      console.log('\nAvailable skills:');
      skills.forEach(s => console.log(`  ${s.name.padEnd(20)} - ${s.description}`));
    }
  }
});

registry.register({
  name: '/tools',
  description: 'Show available tools',
  execute: ({ tools }) => {
    if (tools.length === 0) {
      console.log('\n[System]: No tools available.');
    } else {
      console.log('\nAvailable tools:');
      tools.forEach(t => console.log(`  ${t.name.padEnd(20)} - ${t.description}`));
    }
  }
});

async function runInitialPrompt(agent: Agent) {
  const initialPrompt = process.argv[2];
  if (initialPrompt) {
    console.log(`[User]: ${initialPrompt}\n`);
    const result = await agent.run(initialPrompt);
    console.log(`\n[Assistant]: ${result}`);
  }
}

async function main() {
  const providerType = process.env.LLM_PROVIDER?.toLowerCase() || 'gemini';
  let provider;

  if (providerType === 'local') {
    provider = new LocalProvider();
    console.log('[System] Initialized LocalProvider.');
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Please set GEMINI_API_KEY in your environment or .env file to use Gemini (or set LLM_PROVIDER=local).");
      process.exit(1);
    }
    provider = new GeminiProvider(apiKey);
    console.log('[System] Initialized GeminiProvider.');
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

  // Instantiate the encapsulated Agent class
  const agent = new Agent({
    provider,
    tools,
    skills,
    systemPrompt: 'You are a helpful and educational AI assistant running in a minimal harness. Make use of your available tools.',
    // Optional: override via config or ENV
    maxIterations: 5,
    maxContextChars: 16000
  });

  await runInitialPrompt(agent);

  const terminal = new TerminalUI(registry.getCommands());

  const context: CommandContext = { agent, skills, tools };

  while (true) {
    const userInput = await terminal.askQuestion('\n[User]: ');
    
    if (userInput.startsWith('/')) {
      const command = userInput.trim().toLowerCase();
      const shouldExit = registry.process(command, context);
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

main().catch(console.error);
