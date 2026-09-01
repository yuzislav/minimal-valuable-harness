import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "../types";

export class MCPManager {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(command: string, args: string[], env?: Record<string, string>) {
    this.transport = new StdioClientTransport({
      command,
      args,
      env,
    });
    
    this.client = new Client({
      name: "minimal-valuable-harness",
      version: "1.0.0",
    }, {
      capabilities: {}
    });
  }

  async connect() {
    await this.client.connect(this.transport);
  }

  async disconnect() {
    await this.transport.close();
  }

  async loadTools(): Promise<Tool[]> {
    const response = await this.client.listTools();
    
    return response.tools.map((mcpTool) => ({
      name: mcpTool.name,
      description: mcpTool.description || "",
      parameters: mcpTool.inputSchema,
      execute: async (args: Record<string, any>) => {
        try {
          const result = await this.client.callTool({
            name: mcpTool.name,
            arguments: args
          });
          
          if (result.isError) {
             return { error: true, content: result.content };
          }
          // The result.content is usually an array of text/image objects
          if (Array.isArray(result.content)) {
            const textParts = result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text);
            if (textParts.length > 0) {
              return textParts.join('\n');
            }
          }
          return result.content;
        } catch (err: any) {
          return { error: err.message || String(err) };
        }
      }
    }));
  }
}
