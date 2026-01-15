import * as path from 'path';
import { EventEmitter } from 'events';
import { Config } from '../config.js';
import { WorkspaceManager, Workspace } from './workspace-manager.js';
import { ProcessSupervisor } from './process-supervisor.js';
import { StateClient } from './state-client.js';
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
  private stateClient: StateClient;

  constructor(deps: SessionManagerDeps) {
    super();
    this.config = deps.config;
    this.logger = deps.logger;

    // Initialize components
    this.workspaceManager = new WorkspaceManager(this.config, this.logger);
    this.supervisor = new ProcessSupervisor(this.logger);
    this.portFinder = new PortFinder();

    // StateClient for shared session state (used when sessionId is provided from core.start_session)
    const sessionsDir = path.join(path.dirname(this.config.workspacesDir), 'sessions');
    this.stateClient = new StateClient(sessionsDir, this.logger);

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
    // Use provided sessionId (from core.start_session) or generate a new one
    const useSharedSession = !!input.sessionId;
    let sessionId: string;

    if (useSharedSession) {
      // Verify the session exists in shared state
      const exists = await this.stateClient.sessionExists(input.sessionId!);
      if (!exists) {
        throw new SniaffError(
          ErrorCode.SESSION_NOT_FOUND,
          `Session '${input.sessionId}' not found. Create it first with core.start_session()`,
          { sessionId: input.sessionId }
        );
      }
      const isActive = await this.stateClient.isSessionActive(input.sessionId!);
      if (!isActive) {
        throw new SniaffError(
          ErrorCode.SESSION_NOT_FOUND,
          `Session '${input.sessionId}' is not active`,
          { sessionId: input.sessionId }
        );
      }
      sessionId = input.sessionId!;
      // Update shared state to indicate android is starting
      await this.stateClient.updateAndroid(sessionId, { status: 'starting' });
    } else {
      sessionId = generateSessionId();
    }

    let session: Session | null = null;
    let workspace: Workspace | null = null;
    const warnings: string[] = [];
    let avdSetupInfo: AvdSetupInfo | undefined;

    this.logger.info('Starting session', { sessionId, useSharedSession });

    try {
      // State: SETUP_AVD - Ensure SniaffPhone AVD exists (create + root if needed)
      this.updateState(sessionId, SessionState.SETUP_AVD);
      const avdSetupResult = await this.avdSetupAdapter.ensureSniaffAvd();
      // First run requires Magisk setup if AVD was just created and rooted
      const isFirstRun = avdSetupResult.wasCreated && avdSetupResult.wasRooted;

      avdSetupInfo = {
        avdName: avdSetupResult.avdName,
        wasCreated: avdSetupResult.wasCreated,
        wasRooted: avdSetupResult.wasRooted,
        systemImage: avdSetupResult.systemImage,
        requiresMagiskSetup: isFirstRun,
      };

      if (isFirstRun) {
        warnings.push(
          'FIRST RUN: Magisk setup required. Please open the Magisk app on the emulator and complete the initial configuration. ' +
          'This is a one-time setup - tap "OK" when Magisk prompts to complete installation, then the device will reboot.'
        );
      }

      // Override avdName with SniaffPhone (the managed AVD)
      const avdName = avdSetupResult.avdName;

      // State: CREATE_WORKSPACE
      this.updateState(sessionId, SessionState.CREATE_WORKSPACE);
      workspace = await this.workspaceManager.create(sessionId);

      // Register session log file
      await this.logger.registerSessionLog(sessionId, workspace.logsDir);

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

      // Check root status after boot
      const isRooted = await this.emulatorAdapter.checkRootStatus(session.adbPort);

      if (!isRooted) {
        // Root check failed - need to stop emulator, delete AVD, recreate everything
        this.logger.warn('Root check failed post-boot, triggering full AVD recreation', {
          sessionId,
          avdName: avdSetupResult.avdName,
        });

        // Stop the non-rooted emulator
        if (session.emulatorPid) {
          await this.emulatorAdapter.stop(session.emulatorPid);
          session.emulatorPid = null;
        }

        // Force recreate AVD (delete + create + root)
        this.updateState(sessionId, SessionState.SETUP_AVD);
        const recreatedAvd = await this.avdSetupAdapter.forceRecreateAvd();
        avdSetupInfo = {
          avdName: recreatedAvd.avdName,
          wasCreated: recreatedAvd.wasCreated,
          wasRooted: recreatedAvd.wasRooted,
          systemImage: recreatedAvd.systemImage,
          requiresMagiskSetup: true, // Recreation always requires Magisk setup
        };

        warnings.push(
          'FIRST RUN: Magisk setup required. Please open the Magisk app on the emulator and complete the initial configuration. ' +
          'This is a one-time setup - tap "OK" when Magisk prompts to complete installation, then the device will reboot.'
        );

        // Restart emulator with newly rooted AVD
        this.updateState(sessionId, SessionState.START_EMULATOR);
        session.state = SessionState.START_EMULATOR;

        const newEmulatorResult = await this.emulatorAdapter.start({
          avdName: recreatedAvd.avdName,
          port: input.emulatorPort,
          headless: input.headless,
          logFile: path.join(workspace.logsDir, 'emulator.log'),
        });
        session.emulatorPort = newEmulatorResult.consolePort;
        session.adbPort = newEmulatorResult.adbPort;
        session.emulatorPid = newEmulatorResult.pid;

        // Wait for boot again
        this.updateState(sessionId, SessionState.WAIT_BOOT);
        session.state = SessionState.WAIT_BOOT;

        await this.emulatorAdapter.waitForBoot(session.adbPort, input.bootTimeout);

        // Verify root status after recreation
        const isRootedAfterRecreate = await this.emulatorAdapter.checkRootStatus(session.adbPort);
        if (!isRootedAfterRecreate) {
          throw new SniaffError(
            ErrorCode.ROOT_CHECK_FAILED,
            'Device is not rooted even after AVD recreation. rootAVD may have failed.',
            { sessionId, avdName: recreatedAvd.avdName }
          );
        }

        this.logger.info('Root check passed after AVD recreation', { sessionId });
        warnings.push('AVD was recreated due to failed root check on first boot');
      }

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

      // If using shared session, update the shared state.json
      if (useSharedSession) {
        await this.stateClient.updateAndroid(sessionId, {
          status: 'ready',
          emulatorPort: session.emulatorPort,
          adbPort: session.adbPort,
          pid: session.emulatorPid || undefined,
        });
      }

      this.logger.info('Session started successfully', {
        sessionId,
        emulatorPort: session.emulatorPort,
        adbPort: session.adbPort,
        useSharedSession,
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

    // Unregister session log
    this.logger.unregisterSessionLog(session.sessionId);

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

    // Unregister session log
    this.logger.unregisterSessionLog(sessionId);

    this.sessions.delete(sessionId);
    this.logger.info('Session stopped', { sessionId });
  }
}
