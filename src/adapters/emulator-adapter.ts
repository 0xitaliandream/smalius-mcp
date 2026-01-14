import { createWriteStream, WriteStream } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../config.js';
import { ProcessSupervisor } from '../core/process-supervisor.js';
import { PortFinder } from '../utils/port-finder.js';
import { Logger } from '../utils/logger.js';
import { SniaffError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export interface EmulatorStartOptions {
  avdName: string;
  port?: number;
  headless?: boolean;
  logFile: string;
}

export interface EmulatorStartResult {
  pid: number;
  consolePort: number;
  adbPort: number;
}

export interface EmulatorAdapterDeps {
  config: Config;
  supervisor: ProcessSupervisor;
  portFinder: PortFinder;
  logger: Logger;
}

export class EmulatorAdapter {
  private config: Config;
  private supervisor: ProcessSupervisor;
  private portFinder: PortFinder;
  private logger: Logger;

  constructor(deps: EmulatorAdapterDeps) {
    this.config = deps.config;
    this.supervisor = deps.supervisor;
    this.portFinder = deps.portFinder;
    this.logger = deps.logger;
  }

  async listAvds(): Promise<string[]> {
    try {
      const { stdout } = await execPromise(`${this.config.emulatorPath} -list-avds`);
      return stdout.trim().split('\n').filter(Boolean);
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
        throw new SniaffError(
          ErrorCode.EMULATOR_BINARY_NOT_FOUND,
          `Emulator not found at: ${this.config.emulatorPath}`,
          { path: this.config.emulatorPath }
        );
      }
      throw new SniaffError(
        ErrorCode.EMULATOR_START_FAILED,
        `Failed to list AVDs: ${err.message}`,
        { command: `${this.config.emulatorPath} -list-avds` }
      );
    }
  }

  async start(options: EmulatorStartOptions): Promise<EmulatorStartResult> {
    // Verify AVD exists
    const avds = await this.listAvds();
    if (!avds.includes(options.avdName)) {
      throw new SniaffError(ErrorCode.AVD_NOT_FOUND, `AVD '${options.avdName}' not found`, {
        availableAvds: avds,
      });
    }

    // Find available console port (must be even, 5554-5682)
    let consolePort = options.port || this.config.defaultEmulatorPort;
    if (consolePort % 2 !== 0) consolePort++;

    try {
      consolePort = await this.portFinder.findAvailableEven(consolePort, 5682);
    } catch {
      throw new SniaffError(
        ErrorCode.EMULATOR_START_FAILED,
        'No available emulator ports in range 5554-5682'
      );
    }

    const adbPort = consolePort + 1;

    // Build emulator arguments
    const args = [
      '-avd',
      options.avdName,
      '-port',
      String(consolePort),
      '-no-snapshot-save',
    ];

    if (options.headless) {
      args.push('-no-window');
    }

    // Create log file stream
    let logStream: WriteStream;
    try {
      logStream = createWriteStream(options.logFile, { flags: 'a' });
    } catch (err) {
      throw new SniaffError(
        ErrorCode.EMULATOR_START_FAILED,
        `Failed to create log file: ${options.logFile}`,
        { error: String(err) }
      );
    }

    try {
      const info = await this.supervisor.spawn(this.config.emulatorPath, args, {
        onStdout: (data) => logStream.write(data),
        onStderr: (data) => logStream.write(data),
      });

      // Wait a moment to ensure it didn't crash
      await this.delay(1000);

      if (!this.supervisor.isRunning(info.pid)) {
        throw new SniaffError(
          ErrorCode.EMULATOR_START_FAILED,
          'Emulator process exited immediately',
          { avdName: options.avdName }
        );
      }

      this.logger.info('Emulator started', {
        pid: info.pid,
        consolePort,
        adbPort,
        avdName: options.avdName,
      });

      return { pid: info.pid, consolePort, adbPort };
    } catch (error) {
      logStream.end();
      if (error instanceof SniaffError) throw error;

      const err = error as Error & { code?: string };
      if (err.code === 'ENOENT') {
        throw new SniaffError(
          ErrorCode.EMULATOR_BINARY_NOT_FOUND,
          `Emulator not found at: ${this.config.emulatorPath}`,
          { path: this.config.emulatorPath }
        );
      }

      throw new SniaffError(
        ErrorCode.EMULATOR_START_FAILED,
        `Failed to start emulator: ${err.message}`,
        { avdName: options.avdName }
      );
    }
  }

  async waitForBoot(adbPort: number, timeout: number): Promise<void> {
    const deviceId = `emulator-${adbPort - 1}`;
    const startTime = Date.now();

    this.logger.info('Waiting for emulator boot', { deviceId, timeout });

    // First wait for device to appear in adb devices
    await this.waitForDevice(deviceId, timeout);

    // Then poll for boot completion
    while (Date.now() - startTime < timeout) {
      try {
        const { stdout } = await execPromise(
          `${this.config.adbPath} -s ${deviceId} shell getprop sys.boot_completed`
        );

        if (stdout.trim() === '1') {
          this.logger.info('Emulator boot completed', {
            deviceId,
            duration: Date.now() - startTime,
          });
          return;
        }
      } catch {
        // Device not ready yet, continue polling
      }

      await this.delay(this.config.bootPollInterval);
    }

    throw new SniaffError(
      ErrorCode.EMULATOR_BOOT_TIMEOUT,
      `Emulator boot timed out after ${timeout}ms`,
      { deviceId, timeout }
    );
  }

  private async waitForDevice(deviceId: string, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const { stdout } = await execPromise(`${this.config.adbPath} devices`);
        if (stdout.includes(deviceId)) {
          this.logger.info('Device appeared in adb', { deviceId });
          return;
        }
      } catch (error) {
        const err = error as Error & { code?: string };
        if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
          throw new SniaffError(
            ErrorCode.ADB_NOT_FOUND,
            `ADB not found at: ${this.config.adbPath}`,
            { path: this.config.adbPath }
          );
        }
      }

      await this.delay(1000);
    }

    throw new SniaffError(
      ErrorCode.EMULATOR_BOOT_TIMEOUT,
      `Device ${deviceId} not found in ADB within timeout`,
      { deviceId, timeout }
    );
  }

  async setProxy(adbPort: number, host: string, port: number): Promise<void> {
    const deviceId = `emulator-${adbPort - 1}`;

    try {
      await execPromise(
        `${this.config.adbPath} -s ${deviceId} shell settings put global http_proxy ${host}:${port}`
      );
      this.logger.info('Proxy configured', { deviceId, host, port });
    } catch (error) {
      const err = error as Error;
      throw new SniaffError(
        ErrorCode.PROXY_CONFIG_FAILED,
        `Failed to configure proxy: ${err.message}`,
        { deviceId, host, port }
      );
    }
  }

  async clearProxy(adbPort: number): Promise<void> {
    const deviceId = `emulator-${adbPort - 1}`;
    try {
      await execPromise(
        `${this.config.adbPath} -s ${deviceId} shell settings put global http_proxy :0`
      );
      this.logger.info('Proxy cleared', { deviceId });
    } catch {
      // Best effort - ignore errors on clear
    }
  }

  async stop(pid: number): Promise<void> {
    await this.supervisor.kill(pid);
    this.logger.info('Emulator stopped', { pid });
  }

  /**
   * Check if the emulator has root access (su binary available and working).
   * Returns true if rooted, false otherwise.
   */
  async checkRootStatus(adbPort: number): Promise<boolean> {
    const deviceId = `emulator-${adbPort - 1}`;

    this.logger.info('Checking root status', { deviceId });

    try {
      // Try to run 'su -c id' and check if we get uid=0(root)
      const { stdout } = await execPromise(
        `${this.config.adbPath} -s ${deviceId} shell "su -c id"`,
        { timeout: 10000 }
      );

      const isRooted = stdout.includes('uid=0');
      this.logger.info('Root status check completed', { deviceId, isRooted, output: stdout.trim() });

      return isRooted;
    } catch (error) {
      // If su command fails, we're not rooted
      const err = error as Error;
      this.logger.warn('Root check failed - device is not rooted', {
        deviceId,
        error: err.message,
      });
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
