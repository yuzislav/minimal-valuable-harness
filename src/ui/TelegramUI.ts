import TelegramBot from 'node-telegram-bot-api';
import { Agent } from '../harness/core/Agent';
import { CommandRegistry, CommandContext } from './CommandRegistry';

const MAX_MESSAGE_CHARS = 4096;

export class TelegramUI {
  private bot: TelegramBot;
  private agents: Map<number, Agent> = new Map();
  private allowedUserIds: Set<number> = new Set();
  private allowAll: boolean;
  private agentFactory: () => Agent;

  private registry: CommandRegistry;
  private skills: any[];
  private tools: any[];

  constructor(token: string, agentFactory: () => Agent, registry: CommandRegistry, skills: any[], tools: any[]) {
    this.agentFactory = agentFactory;
    this.registry = registry;
    this.skills = skills;
    this.tools = tools;

    // Numeric Telegram user IDs only: usernames are mutable and case-insensitive,
    // so they are not a safe allow-list key (see README).
    this.allowAll = process.env.TELEGRAM_ALLOW_ALL === 'true';
    const allowed = process.env.TELEGRAM_ALLOWED_USERS;
    if (allowed) {
      for (const raw of allowed.split(',').map(u => u.trim()).filter(Boolean)) {
        const id = Number(raw);
        if (Number.isInteger(id)) {
          this.allowedUserIds.add(id);
        } else {
          console.warn(`\x1b[33m[System]: Ignoring non-numeric TELEGRAM_ALLOWED_USERS entry '${raw}'.\x1b[0m`);
        }
      }
    }

    if (this.allowedUserIds.size === 0 && !this.allowAll) {
      throw new Error(
        'TELEGRAM_ALLOWED_USERS must be set to a comma-separated list of numeric Telegram user IDs. ' +
        'Refusing to start with no allow-list. Set TELEGRAM_ALLOW_ALL=true to explicitly allow every user instead.'
      );
    }

    this.bot = new TelegramBot(token, { polling: true });
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
    if (this.allowAll) return true;
    const userId = msg.from?.id;
    return userId !== undefined && this.allowedUserIds.has(userId);
  }

  // Telegram rejects messages over 4096 chars and empty messages; split and skip accordingly.
  private async sendReply(chatId: number, text: string): Promise<void> {
    if (!text) return;
    for (let i = 0; i < text.length; i += MAX_MESSAGE_CHARS) {
      await this.bot.sendMessage(chatId, text.slice(i, i + MAX_MESSAGE_CHARS));
    }
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
            // Strip ANSI codes before sending to Telegram
            const strippedText = text.replace(/\x1b\[[0-9;]*m/g, '');
            await this.sendReply(chatId, strippedText);
          }
        };

        await this.registry.process(commandName, context);
        return;
      }

      const agent = this.getOrCreateAgent(chatId);

      try {
        console.log(`[TelegramUI]: Received message from chat ${chatId}: ${msg.text}`);
        const result = await agent.run(msg.text);
        await this.sendReply(chatId, result);
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
