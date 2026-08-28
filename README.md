# minimal-valuable-harness

A minimal, yet powerful, harness for building and testing agentic workflows.

## Features

- **Minimal Codebase**: Designed to be lightweight and easy to understand with the absolute minimum amount of code required.
- **Skills & Tools**: Built-in support for defining and executing agent skills and tools.
- **MCP Support**: Full integration with the Model Context Protocol (MCP) for seamless interaction with external tools and context.
- **Handy CLI**: Includes a minimal, intuitive command-line interface for quick testing and execution.

## Usage

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your environment variables. Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

### Running the Application

By default, the application runs in Terminal mode. You can also run it as a Telegram bot.

#### Terminal Mode

Start the interactive CLI:
```bash
npm start
```

You can also pass an initial prompt directly:
```bash
npm start -- "What is the weather in Tokyo?"
```

#### Telegram Bot Mode

To run the harness as a Telegram bot, ensure you have set `TELEGRAM_BOT_TOKEN` in your `.env` file. You can also optionally restrict access by providing a comma-separated list of usernames or User IDs in `TELEGRAM_ALLOWED_USERS`.

Start the bot using the `--ui telegram` flag:
```bash
npm start -- --ui telegram
```

### CLI Commands

Inside the interactive session, you have access to several slash commands:
- `/help` - Show available commands
- `/skills` - Show available skills and their descriptions
- `/tools` - Show available tools and their descriptions
- `/clear` - Clear the agent context/history
- `/history` - Show full conversation history
- `/debug` - Toggle debug logging
- `/exit` or `/quit` - Exit the application

### Debug Mode (Educational Value)

You can toggle debug mode at any time using the `/debug` command, or by setting `DEBUG=true` in your environment.

When debug mode is enabled, the harness prints detailed information about the agent's internal reasoning process, including:
- When the agent decides to use a tool
- The arguments passed to tools and skills
- The raw responses returned by tools and skills

This transparency makes `minimal-valuable-harness` an excellent educational resource for understanding how LLM agents "think" and interact with the outside world using function calling.

### MCP Support

To run the harness with MCP servers, create an `mcp.json` file in the root directory:
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "mcp-sqlite-server", "test.db"],
      "env": {}
    }
  }
}
```
The harness will automatically detect this file and load all configured servers.