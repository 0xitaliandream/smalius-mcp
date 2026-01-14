export enum ErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  WORKSPACE_CREATE_FAILED = 'WORKSPACE_CREATE_FAILED',
  MITM_START_FAILED = 'MITM_START_FAILED',
  MITM_PORT_UNAVAILABLE = 'MITM_PORT_UNAVAILABLE',
  EMULATOR_START_FAILED = 'EMULATOR_START_FAILED',
  EMULATOR_BOOT_TIMEOUT = 'EMULATOR_BOOT_TIMEOUT',
  AVD_NOT_FOUND = 'AVD_NOT_FOUND',
  ADB_NOT_FOUND = 'ADB_NOT_FOUND',
  ADB_COMMAND_FAILED = 'ADB_COMMAND_FAILED',
  EMULATOR_BINARY_NOT_FOUND = 'EMULATOR_BINARY_NOT_FOUND',
  MITMDUMP_NOT_FOUND = 'MITMDUMP_NOT_FOUND',
  PROXY_CONFIG_FAILED = 'PROXY_CONFIG_FAILED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  ROLLBACK_FAILED = 'ROLLBACK_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class SmaliusError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SmaliusError';
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
