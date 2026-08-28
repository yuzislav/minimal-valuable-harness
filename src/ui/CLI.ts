import { Agent } from '../harness/Agent';

export interface CommandContext {
  agent: Agent;
  skills: any[];
  tools: any[];
}

export interface Command {
  name: string;
  description: string;
  execute: (context: CommandContext) => boolean | void;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  public register(command: Command): void {
    this.commands.set(command.name, command);
  }

  public getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  public process(commandName: string, context: CommandContext): boolean {
    const command = this.commands.get(commandName);
    if (command) {
      const shouldExit = command.execute(context);
      return shouldExit === true;
    } else {
      console.log(`[System]: Unknown command: ${commandName}. Type /help for available commands.`);
      return false;
    }
  }
}
