import * as path from 'path';

export async function loadMCPServers(tools: any[]): Promise<any[]> {
  const activeMcpManagers: any[] = [];
  try {
    const fs = await import('fs');
    const mcpConfigPath = path.resolve(process.cwd(), 'mcp.json');
    if (fs.existsSync(mcpConfigPath)) {
      console.log(`[System] Found mcp.json at ${mcpConfigPath}, loading servers...`);
      const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (mcpConfig.mcpServers) {
        const { MCPManager } = await import('./index');
        for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
          console.log(`[System] Initializing MCP Server '${serverName}' from mcp.json...`);
          try {
            const config = serverConfig as any;
            const command = config.command;
            const args = config.args || [];
            const env = config.env;

            if (!command) {
              console.warn(`[System] Server '${serverName}' is missing 'command', skipping.`);
              continue;
            }

            const mcpManager = new MCPManager(command, args, env);
            activeMcpManagers.push(mcpManager);

            await mcpManager.connect();
            const mcpTools = await mcpManager.loadTools();

            tools.push(...mcpTools);
            console.log(`[System] Successfully loaded ${mcpTools.length} MCP tools from '${serverName}'.`);
          } catch (err: any) {
            console.error(`[System] Failed to initialize MCP Server '${serverName}': ${err.message}`);
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[System] Failed to parse mcp.json: ${err.message}`);
  }
  return activeMcpManagers;
}
