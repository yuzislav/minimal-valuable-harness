import * as readline from 'readline';

// Define an interface for internal readline properties to avoid `any` casts
interface InternalReadline extends readline.Interface {
  _refreshLine?: () => void;
  line: string;
  cursor: number;
  output: NodeJS.WritableStream & { write: (str: string) => boolean };
}

export class TerminalUI {
  private rl: readline.Interface;

  constructor(private commandsList: { name: string; description: string }[]) {
    const completer = (line: string) => {
      if (line.startsWith('/')) {
        const hits = this.matchCommands(line);
        return [hits.length ? [hits[0]] : this.commandsList.map(c => c.name), line];
      }
      return [[], line];
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer
    });

    const rlInternal = this.rl as unknown as InternalReadline;
    const originalRefreshLine = rlInternal._refreshLine;

    if (originalRefreshLine) {
      rlInternal._refreshLine = () => {
        originalRefreshLine.call(this.rl);
        
        const line = rlInternal.line;
        if (line && line.startsWith('/') && rlInternal.cursor === line.length) {
          const hit = this.matchCommands(line)[0];
          
          if (hit && hit.length > line.length) {
            const suggestion = hit.slice(line.length);
            rlInternal.output.write(`\x1b[90m${suggestion}\x1b[0m`);
            readline.moveCursor(rlInternal.output, -suggestion.length, 0);
          }
        }
      };

      process.stdin.on('keypress', () => {
        setImmediate(() => {
          if (rlInternal.line && rlInternal.line.startsWith('/')) {
            if (rlInternal._refreshLine) {
              rlInternal._refreshLine();
            }
          }
        });
      });
    }
  }

  /** Commands starting with `line`, with /help first when only '/' is typed. */
  private matchCommands(line: string): string[] {
    const hits = this.commandsList.map(c => c.name).filter(c => c.startsWith(line.toLowerCase()));
    if (line === '/' && hits.includes('/help')) {
      return ['/help', ...hits.filter(h => h !== '/help')];
    }
    return hits;
  }

  public askQuestion(query: string): Promise<string> {
    return new Promise(resolve => this.rl.question(query, resolve));
  }

  public close() {
    this.rl.close();
  }
}
