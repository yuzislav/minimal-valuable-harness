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
    { name: '/debug', description: 'Toggle debug logging' },
    { name: '/history', description: 'Show full conversation history' },
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

  // Monkey-patch _refreshLine to add inline ghost text for commands
  const originalRefreshLine = (rl as any)._refreshLine;
  if (originalRefreshLine) {
    (rl as any)._refreshLine = function() {
      // Call the original method to render the prompt and current input
      originalRefreshLine.call(this);
      
      const line = this.line;
      // Only show ghost text if typing a command and cursor is at the end
      if (line && line.startsWith('/') && this.cursor === line.length) {
        const commandNames = COMMANDS.map(c => c.name);
        const hit = commandNames.find((c) => c.startsWith(line.toLowerCase()));
        
        if (hit && hit.length > line.length) {
          const suggestion = hit.slice(line.length);
          // \x1b[90m is gray/dim, \x1b[0m resets color
          this.output.write(`\x1b[90m${suggestion}\x1b[0m`);
          // Move the cursor back to where the user is actually typing
          readline.moveCursor(this.output, -suggestion.length, 0);
        }
      }
    };

    // Force refresh on keypress because readline optimizes simple appends and doesn't call _refreshLine
    process.stdin.on('keypress', () => {
      setImmediate(() => {
        if ((rl as any).line && (rl as any).line.startsWith('/')) {
          (rl as any)._refreshLine();
        }
      });
    });
  }

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
      } else if (command === '/debug') {
        process.env.DEBUG = process.env.DEBUG ? '' : 'true';
        console.log(`[System]: Debug logging is now ${process.env.DEBUG ? 'ON' : 'OFF'}.`);
        continue;
      } else if (command === '/history') {
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
