import * as path from 'path';
import { EventEmitter } from 'events';
import { Config } from '../config.js';
import { WorkspaceManager, Workspace } from './workspace-manager.js';
import { ProcessSupervisor } from './process-supervisor.js';
import { EmulatorAdapter } from '../adapters/emulator-adapter.js';
import { AvdSetupAdapter } from '../adapters/avd-setup-adapter.js';
import { PortFinder } from '../utils/port-finder.js';
import { Logger } from '../utils/logger.js';
import { generateSessionId } from '../utils/id-generator.js';
import { Session, SessionState, SessionStartResult, AvdSetupInfo } from '../types/session.js';
import { StartInput } from '../types/schemas.js';
import { SniaffError, ErrorCode } from '../types/errors.js';

export interface SessionManagerDeps {
  config: Config;
  logger: Logger;
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private config: Config;
  private logger: Logger;
  private workspaceManager: WorkspaceManager;
  private supervisor: ProcessSupervisor;
  private portFinder: PortFinder;
  private emulatorAdapter: EmulatorAdapter;
  private avdSetupAdapter: AvdSetupAdapter;

  constructor(deps: SessionManagerDeps) {
    super();
    this.config = deps.config;
    this.logger = deps.logger;

    // Initialize components
    this.workspaceManager = new WorkspaceManager(this.config, this.logger);
    this.supervisor = new ProcessSupervisor(this.logger);
    this.portFinder = new PortFinder();

    this.emulatorAdapter = new EmulatorAdapter({
      config: this.config,
      supervisor: this.supervisor,
      portFinder: this.portFinder,
      logger: this.logger,
    });

    this.avdSetupAdapter = new AvdSetupAdapter({
      config: this.config,
      supervisor: this.supervisor,
      logger: this.logger,
    });
  }

  async startSession(input: StartInput): Promise<SessionStartResult> {
    const sessionId = generateSessionId();
    let session: Session | null = null;
    let workspace: Workspace | null = null;
    const warnings: string[] = [];
    let avdSetupInfo: AvdSetupInfo | undefined;

    this.logger.info('Starting session', { sessionId });

    try {
      // State: SETUP_AVD - Ensure SniaffPhone AVD exists (create + root if needed)
      this.updateState(sessionId, SessionState.SETUP_AVD);
      const avdSetupResult = await this.avdSetupAdapter.ensureSniaffAvd();
      avdSetupInfo = {
        avdName: avdSetupResult.avdName,
        wasCreated: avdSetupResult.wasCreated,
        wasRooted: avdSetupResult.wasRooted,
        systemImage: avdSetupResult.systemImage,
      };

      // Override avdName with SniaffPhone (the managed AVD)
      const avdName = avdSetupResult.avdName;

      // State: CREATE_WORKSPACE
      this.updateState(sessionId, SessionState.CREATE_WORKSPACE);
      workspace = await this.workspaceManager.create(sessionId);

      session = {
        sessionId,
        avdName: avdName,
        emulatorPort: 0,
        adbPort: 0,
        createdAt: new Date().toISOString(),
        state: SessionState.CREATE_WORKSPACE,
        workspacePath: workspace.path,
        emulatorPid: null,
      };
      this.sessions.set(sessionId, session);

      // State: START_EMULATOR
      this.updateState(sessionId, SessionState.START_EMULATOR);
      session.state = SessionState.START_EMULATOR;

      const emulatorResult = await this.emulatorAdapter.start({
        avdName: avdName,
        port: input.emulatorPort,
        headless: input.headless,
        logFile: path.join(workspace.logsDir, 'emulator.log'),
      });
      session.emulatorPort = emulatorResult.consolePort;
      session.adbPort = emulatorResult.adbPort;
      session.emulatorPid = emulatorResult.pid;

      // State: WAIT_BOOT
      this.updateState(sessionId, SessionState.WAIT_BOOT);
      session.state = SessionState.WAIT_BOOT;

      await this.emulatorAdapter.waitForBoot(session.adbPort, input.bootTimeout);

      // State: READY
      this.updateState(sessionId, SessionState.READY);
      session.state = SessionState.READY;

      // Update meta.json with final state
      await this.workspaceManager.updateMeta(sessionId, {
        sessionId: session.sessionId,
        avdName: session.avdName,
        emulatorPort: session.emulatorPort,
        adbPort: session.adbPort,
        createdAt: session.createdAt,
        state: session.state,
        workspacePath: session.workspacePath,
      });

      this.logger.info('Session started successfully', {
        sessionId,
        emulatorPort: session.emulatorPort,
        adbPort: session.adbPort,
      });

      const result: SessionStartResult = {
        sessionId,
        workspacePath: session.workspacePath,
        emulatorPort: session.emulatorPort,
        adbPort: session.adbPort,
        state: SessionState.READY,
        avdSetup: avdSetupInfo,
      };

      if (warnings.length > 0) {
        result.warnings = warnings;
      }

      return result;
    } catch (error) {
      // Rollback on any failure
      this.logger.error('Session start failed, rolling back', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.rollback(session);

      if (error instanceof SniaffError) {
        throw error;
      }

      throw new SniaffError(
        ErrorCode.INTERNAL_ERROR,
        `Session start failed: ${error instanceof Error ? error.message : String(error)}`,
        { sessionId }
      );
    }
  }

  private updateState(sessionId: string, state: SessionState): void {
    this.emit('stateChange', sessionId, state);
    this.logger.info('State change', { sessionId, state });
  }

  private async rollback(session: Session | null): Promise<void> {
    if (!session) return;

    this.logger.info('Rolling back session', { sessionId: session.sessionId });
    session.state = SessionState.ERROR;

    // Stop emulator if running
    if (session.emulatorPid) {
      try {
        await this.emulatorAdapter.stop(session.emulatorPid);
      } catch (error) {
        this.logger.error('Failed to stop emulator during rollback', {
          pid: session.emulatorPid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Update meta to ERROR state (keep workspace for debugging)
    try {
      await this.workspaceManager.updateMeta(session.sessionId, {
        state: SessionState.ERROR,
      });
    } catch {
      // Ignore meta update errors during rollback
    }

    this.sessions.delete(session.sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SniaffError(ErrorCode.SESSION_NOT_FOUND, `Session '${sessionId}' not found`);
    }

    this.logger.info('Stopping session', { sessionId });

    // Stop emulator
    if (session.emulatorPid) {
      await this.emulatorAdapter.stop(session.emulatorPid);
    }

    // Cleanup workspace directory
    await this.workspaceManager.cleanup(sessionId);

    this.sessions.delete(sessionId);
    this.logger.info('Session stopped', { sessionId });
  }
}
