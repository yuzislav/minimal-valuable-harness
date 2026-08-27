import 'dotenv/config';
import * as path from 'path';
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

  const prompt = process.argv[2] || "Execute some javascript to calculate the 10th fibonacci number.";
  console.log(`[User] ${prompt}\n`);
  
  // Run the loop
  const result = await agent.run(prompt);
  console.log(`\n[Assistant] ${result}`);
  
  if (activeMcpManager) {
    await activeMcpManager.disconnect();
  }
}

main().catch(console.error);
