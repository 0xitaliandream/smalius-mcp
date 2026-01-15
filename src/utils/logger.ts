import * as fs from 'fs/promises';
import * as path from 'path';

export interface LoggerOptions {
  logDir: string;
  name: string;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private name: string;
  private sessionLogFiles: Map<string, string> = new Map();

  constructor(options: LoggerOptions) {
    this.name = options.name;
  }

  private async ensureLogDir(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Best effort - continue even if we can't create log dir
    }
  }

  /**
   * Register a session-specific log file. Logs with matching sessionId will be written there.
   */
  async registerSessionLog(sessionId: string, logsDir: string): Promise<void> {
    await this.ensureLogDir(logsDir);
    const sessionLogFile = path.join(logsDir, 'session.log');
    this.sessionLogFiles.set(sessionId, sessionLogFile);
  }

  /**
   * Unregister a session log file (call when session ends).
   */
  unregisterSessionLog(sessionId: string): void {
    this.sessionLogFiles.delete(sessionId);
  }

  private formatMessage(level: LogLevel, message: string, data?: object): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.name}] ${message}${dataStr}\n`;
  }

  private async write(level: LogLevel, message: string, data?: object): Promise<void> {
    const formatted = this.formatMessage(level, message, data);

    // Write to stderr (MCP requirement - stdout is for JSON-RPC only)
    process.stderr.write(formatted);

    // If data contains sessionId, write to session-specific log
    if (data && 'sessionId' in data) {
      const sessionId = data.sessionId as string;
      const sessionLogFile = this.sessionLogFiles.get(sessionId);
      if (sessionLogFile) {
        try {
          await fs.appendFile(sessionLogFile, formatted);
        } catch {
          // Ignore session log write errors
        }
      }
    }
  }

  debug(message: string, data?: object): void {
    this.write('debug', message, data);
  }

  info(message: string, data?: object): void {
    this.write('info', message, data);
  }

  warn(message: string, data?: object): void {
    this.write('warn', message, data);
  }

  error(message: string, data?: object): void {
    this.write('error', message, data);
  }
}
