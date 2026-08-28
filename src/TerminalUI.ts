import * as readline from 'readline';

export class TerminalUI {
  private rl: readline.Interface;

  constructor(private commandsList: { name: string; description: string }[]) {
    const completer = (line: string) => {
      const commandNames = this.commandsList.map(c => c.name);
      if (line.startsWith('/')) {
        const hits = commandNames.filter((c) => c.startsWith(line.toLowerCase()));
        return [hits.length ? hits : commandNames, line];
      }
      return [[], line];
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer
    });

    const originalRefreshLine = (this.rl as any)._refreshLine;
    if (originalRefreshLine) {
      (this.rl as any)._refreshLine = () => {
        originalRefreshLine.call(this.rl);
        
        const line = (this.rl as any).line;
        if (line && line.startsWith('/') && (this.rl as any).cursor === line.length) {
          const commandNames = this.commandsList.map(c => c.name);
          const hit = commandNames.find((c) => c.startsWith(line.toLowerCase()));
          
          if (hit && hit.length > line.length) {
            const suggestion = hit.slice(line.length);
            (this.rl as any).output.write(`\x1b[90m${suggestion}\x1b[0m`);
            readline.moveCursor((this.rl as any).output, -suggestion.length, 0);
          }
        }
      };

      process.stdin.on('keypress', () => {
        setImmediate(() => {
          if ((this.rl as any).line && (this.rl as any).line.startsWith('/')) {
            (this.rl as any)._refreshLine();
          }
        });
      });
    }
  }

  public askQuestion(query: string): Promise<string> {
    return new Promise(resolve => this.rl.question(query, resolve));
  }

  public close() {
    this.rl.close();
  }
}
