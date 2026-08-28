import 'dotenv/config';
import * as path from 'path';
import * as readline from 'readline';
import { GeminiProvider } from './Provider';
import { Agent } from './Agent';
import { execTool } from './tools/exec';
import { curlTool } from './tools/curl';
import { weatherTool } from './tools/weather';
import { loadSkills, createReadSkillTool } from './skills';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Please set GEMINI_API_KEY in your environment or .env file.");
    process.exit(1);
  }

  // Initialize our abstraction layer provider
  const provider = new GeminiProvider(apiKey);

  // Load skills from a 'skills' folder
  const skillsDir = path.join(__dirname, '..', 'skills');
  const skills = loadSkills(skillsDir);

  // Define tools available to the Agent
  const tools = [
    execTool,
    curlTool,
    weatherTool,
    createReadSkillTool(skills)
  ];

  let activeMcpManager: any = null;

  // Integrate MCP Tools if configured
  if (process.env.MCP_SERVER_COMMAND) {
    console.log(`[System] Initializing MCP Server with ${process.env.MCP_SERVER_COMMAND}...`);
    try {
      const { MCPManager } = await import('./mcp');
      // If args are provided, we split them by space. For a robust parser, you might want to use a shell parser
      // but for this minimal harness, a simple split or just passing the exact args works.
      // E.g. MCP_SERVER_ARGS="-y @modelcontextprotocol/server-sqlite --db test.db"
      const argsStr = process.env.MCP_SERVER_ARGS || "";
      const args = argsStr ? argsStr.split(' ') : [];

      const mcpManager = new MCPManager(process.env.MCP_SERVER_COMMAND, args);
      activeMcpManager = mcpManager;

      await mcpManager.connect();
      const mcpTools = await mcpManager.loadTools();

      tools.push(...mcpTools);
      console.log(`[System] Successfully loaded ${mcpTools.length} MCP tools.`);
    } catch (err: any) {
      console.error(`[System] Failed to initialize MCP Server: ${err.message}`);
    }
  }

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

  const initialPrompt = process.argv[2];
  if (initialPrompt) {
    console.log(`[User]: ${initialPrompt}\n`);
    const result = await agent.run(initialPrompt);
    console.log(`\n[Assistant]: ${result}`);
  }

  const COMMANDS = [
    { name: '/exit', description: 'Exit the application' },
    { name: '/quit', description: 'Exit the application' },
    { name: '/clear', description: 'Clear the agent context/history' },
    { name: '/help', description: 'Show available commands' }
  ];

  const completer = (line: string) => {
    const commandNames = COMMANDS.map(c => c.name);
    if (line.startsWith('/')) {
      const hits = commandNames.filter((c) => c.startsWith(line.toLowerCase()));
      return [hits.length ? hits : commandNames, line];
    }
    return [[], line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer
  });

  const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
  };

  while (true) {
    const userInput = await askQuestion('\n[User]: ');
    
    if (userInput.startsWith('/')) {
      const command = userInput.trim().toLowerCase();
      if (command === '/exit' || command === '/quit') {
        break;
      } else if (command === '/clear') {
        agent.clearHistory();
        console.log('[System]: Context cleared. Started a new session.');
        continue;
      } else if (command === '/help') {
        console.log('\nAvailable commands:');
        COMMANDS.forEach(c => console.log(`  ${c.name.padEnd(10)} - ${c.description}`));
        continue;
      } else {
        console.log(`[System]: Unknown command: ${command}. Type /help for available commands.`);
        continue;
      }
    }

    if (!userInput.trim()) continue;

    const result = await agent.run(userInput);
    console.log(`\n[Assistant]: ${result}`);
  }

  rl.close();

  if (activeMcpManager) {
    await activeMcpManager.disconnect();
  }
}

main().catch(console.error);
