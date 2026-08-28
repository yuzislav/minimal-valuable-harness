import { Agent } from '../harness/core/Agent';

export interface CommandContext {
  agent: Agent;
  skills: any[];
  tools: any[];
  reply: (text: string) => void | Promise<void>;
}

export interface Command {
  name: string;
  description: string;
  execute: (context: CommandContext) => boolean | void | Promise<boolean | void>;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  public register(command: Command): void {
    this.commands.set(command.name, command);
  }

  public getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  public async process(commandName: string, context: CommandContext): Promise<boolean> {
    const command = this.commands.get(commandName);
    if (command) {
      const shouldExit = await command.execute(context);
      return shouldExit === true;
    } else {
      await context.reply(`[System]: Unknown command: ${commandName}. Type /help for available commands.`);
      return false;
    }
  }
}
