import * as fs from 'fs/promises';
import * as path from 'path';
import { Config } from '../config.js';
import { Logger } from '../utils/logger.js';
import { SessionMeta, SessionState } from '../types/session.js';
import { SniaffError, ErrorCode } from '../types/errors.js';

export interface Workspace {
  path: string;
  appDir: string;
  logsDir: string;
}

export class WorkspaceManager {
  private config: Config;
  private logger: Logger;

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async create(sessionId: string): Promise<Workspace> {
    const basePath = path.join(this.config.workspacesDir, sessionId);

    const workspace: Workspace = {
      path: basePath,
      appDir: path.join(basePath, 'app'),
      logsDir: path.join(basePath, 'logs'),
    };

    try {
      // Create all directories
      await fs.mkdir(workspace.path, { recursive: true });
      await fs.mkdir(workspace.appDir);
      await fs.mkdir(workspace.logsDir);

      // Create initial meta.json
      const meta: SessionMeta = {
        sessionId,
        avdName: '',
        emulatorPort: 0,
        adbPort: 0,
        createdAt: new Date().toISOString(),
        state: SessionState.CREATE_WORKSPACE,
        workspacePath: basePath,
      };

      await this.writeMeta(basePath, meta);
      this.logger.info('Workspace created', { sessionId, path: basePath });

      return workspace;
    } catch (error) {
      const err = error as Error;
      throw new SniaffError(
        ErrorCode.WORKSPACE_CREATE_FAILED,
        `Failed to create workspace: ${err.message}`,
        { sessionId, path: basePath }
      );
    }
  }

  async updateMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void> {
    const basePath = path.join(this.config.workspacesDir, sessionId);

    try {
      // Read existing meta
      const existing = await this.readMeta(sessionId);
      const updated = { ...existing, ...meta };
      await this.writeMeta(basePath, updated);
    } catch {
      // If read fails, just write the new meta
      await this.writeMeta(basePath, meta as SessionMeta);
    }
  }

  async readMeta(sessionId: string): Promise<SessionMeta> {
    const basePath = path.join(this.config.workspacesDir, sessionId);
    const metaPath = path.join(basePath, 'meta.json');
    const content = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(content) as SessionMeta;
  }

  private async writeMeta(basePath: string, meta: SessionMeta): Promise<void> {
    const metaPath = path.join(basePath, 'meta.json');
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  async cleanup(sessionId: string): Promise<void> {
    const basePath = path.join(this.config.workspacesDir, sessionId);
    await fs.rm(basePath, { recursive: true, force: true });
    this.logger.info('Workspace cleaned up', { sessionId });
  }

  getWorkspacePath(sessionId: string): string {
    return path.join(this.config.workspacesDir, sessionId);
  }

  getLogsDir(sessionId: string): string {
    return path.join(this.config.workspacesDir, sessionId, 'logs');
  }
}
