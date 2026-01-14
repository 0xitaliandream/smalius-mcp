export enum SessionState {
  IDLE = 'IDLE',
  SETUP_AVD = 'SETUP_AVD',
  CREATE_WORKSPACE = 'CREATE_WORKSPACE',
  START_EMULATOR = 'START_EMULATOR',
  WAIT_BOOT = 'WAIT_BOOT',
  READY = 'READY',
  ERROR = 'ERROR',
  STOPPED = 'STOPPED',
}

export interface SessionMeta {
  sessionId: string;
  avdName: string;
  emulatorPort: number;
  adbPort: number;
  createdAt: string;
  state: SessionState;
  workspacePath: string;
}

export interface Session extends SessionMeta {
  emulatorPid: number | null;
}

export interface AvdSetupInfo {
  avdName: string;
  wasCreated: boolean;
  wasRooted: boolean;
  systemImage: string;
}

export interface SessionStartResult {
  sessionId: string;
  workspacePath: string;
  emulatorPort: number;
  adbPort: number;
  state: SessionState;
  avdSetup?: AvdSetupInfo;
  warnings?: string[];
}
