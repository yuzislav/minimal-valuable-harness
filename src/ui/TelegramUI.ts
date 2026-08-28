import TelegramBot from 'node-telegram-bot-api';
import { Agent } from '../harness/core/Agent';
import { CommandRegistry, CommandContext } from './CommandRegistry';

export class TelegramUI {
  private bot: TelegramBot;
  private agents: Map<number, Agent> = new Map();
  private allowedUsers: Set<string> = new Set();
  private agentFactory: () => Agent;

  private registry: CommandRegistry;
  private skills: any[];
  private tools: any[];

  constructor(token: string, agentFactory: () => Agent, registry: CommandRegistry, skills: any[], tools: any[]) {
    this.bot = new TelegramBot(token, { polling: true });
    this.agentFactory = agentFactory;
    this.registry = registry;
    this.skills = skills;
    this.tools = tools;

    // Load allowed users from environment variable
    const allowed = process.env.TELEGRAM_ALLOWED_USERS;
    if (allowed) {
      allowed.split(',').forEach(user => this.allowedUsers.add(user.trim()));
    } else {
      console.warn('[System]: TELEGRAM_ALLOWED_USERS is not set. The bot will accept messages from ANY user.');
    }

    this.setupListeners();
    this.setupCommands();
  }

  private setupCommands() {
    const cmds = this.registry.getCommands().map(c => ({
      command: c.name,
      description: c.description
    }));
    this.bot.setMyCommands(cmds).catch(err => console.error('[TelegramUI]: Failed to set bot commands:', err));
  }

  private isAllowed(msg: TelegramBot.Message): boolean {
    if (this.allowedUsers.size === 0) return true;
    const username = msg.from?.username;
    const userId = msg.from?.id.toString();
    
    if (username && this.allowedUsers.has(username)) return true;
    if (userId && this.allowedUsers.has(userId)) return true;
    
    return false;
  }

  private getOrCreateAgent(chatId: number): Agent {
    if (!this.agents.has(chatId)) {
      console.log(`[TelegramUI]: Initializing new Agent for chat ${chatId}`);
      this.agents.set(chatId, this.agentFactory());
    }
    return this.agents.get(chatId)!;
  }

  private setupListeners() {
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      
      if (!msg.text) return;
      
      if (!this.isAllowed(msg)) {
        console.log(`[TelegramUI]: Blocked unauthorized user: ${msg.from?.username || msg.from?.id}`);
        await this.bot.sendMessage(chatId, 'Sorry, you are not authorized to use this bot.');
        return;
      }

      if (msg.text.startsWith('/')) {
        const commandName = msg.text.trim().toLowerCase();
        const agent = this.getOrCreateAgent(chatId);
        
        // /start is a special telegram command not in the registry
        if (commandName === '/start') {
          await this.bot.sendMessage(chatId, 'Hello! I am your AI assistant. Send me a message to begin, or use /help to see available commands.');
          return;
        }

        // Intercept exit commands so users can't shut down the whole server
        if (commandName === '/exit' || commandName === '/quit') {
          await this.bot.sendMessage(chatId, 'The bot runs as a continuous service. You can use /clear to reset your session context instead.');
          return;
        }

        const context: CommandContext = {
          agent,
          skills: this.skills,
          tools: this.tools,
          reply: async (text: string) => {
            await this.bot.sendMessage(chatId, text);
          }
        };

        await this.registry.process(commandName, context);
        return;
      }

      const agent = this.getOrCreateAgent(chatId);
      
      try {
        console.log(`[TelegramUI]: Received message from chat ${chatId}: ${msg.text}`);
        const result = await agent.run(msg.text);
        await this.bot.sendMessage(chatId, result);
      } catch (error: any) {
        console.error(`[TelegramUI]: Error processing message for chat ${chatId}:`, error);
        await this.bot.sendMessage(chatId, 'An error occurred while processing your request.');
      }
    });

    console.log('[TelegramUI]: Bot is running and listening for messages...');
  }

  public async stop() {
    await this.bot.stopPolling();
    console.log('[TelegramUI]: Bot stopped.');
  }
}
