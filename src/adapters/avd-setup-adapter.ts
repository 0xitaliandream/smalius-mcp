import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import * as path from 'path';
import { Config } from '../config.js';
import { ProcessSupervisor } from '../core/process-supervisor.js';
import { Logger } from '../utils/logger.js';
import { SniaffError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export interface AvdSetupAdapterDeps {
  config: Config;
  supervisor: ProcessSupervisor;
  logger: Logger;
}

export interface AvdSetupResult {
  avdName: string;
  wasCreated: boolean;
  wasRooted: boolean;
  systemImage: string;
}

export class AvdSetupAdapter {
  private config: Config;
  private supervisor: ProcessSupervisor;
  private logger: Logger;

  constructor(deps: AvdSetupAdapterDeps) {
    this.config = deps.config;
    this.supervisor = deps.supervisor;
    this.logger = deps.logger;
  }

  async ensureSniaffAvd(): Promise<AvdSetupResult> {
    const avdName = this.config.sniaffAvdName;
    const systemImage = this.config.sniaffSystemImage;

    this.logger.info('Ensuring SniaffPhone AVD exists', { avdName, systemImage });

    // Check if AVD already exists
    const avdExists = await this.avdExists(avdName);
    if (avdExists) {
      this.logger.info('SniaffPhone AVD already exists', { avdName });
      return {
        avdName,
        wasCreated: false,
        wasRooted: false,
        systemImage,
      };
    }

    // AVD doesn't exist, need to create it
    this.logger.info('SniaffPhone AVD not found, starting setup...', { avdName });

    // Step 1: Ensure system image is installed
    await this.ensureSystemImage(systemImage);

    // Step 2: Create the AVD
    await this.createAvd(avdName, systemImage);

    // Step 3: Root the AVD with rootAVD
    await this.rootAvd(systemImage);

    this.logger.info('SniaffPhone AVD setup completed', { avdName });

    return {
      avdName,
      wasCreated: true,
      wasRooted: true,
      systemImage,
    };
  }

  private async avdExists(avdName: string): Promise<boolean> {
    try {
      const { stdout } = await execPromise(`${this.config.emulatorPath} -list-avds`);
      const avds = stdout.trim().split('\n').filter(Boolean);
      return avds.includes(avdName);
    } catch (error) {
      this.logger.warn('Failed to list AVDs', { error: String(error) });
      return false;
    }
  }

  private async ensureSystemImage(systemImage: string): Promise<void> {
    this.logger.info('Checking system image', { systemImage });

    // Check if system image is already installed
    const isInstalled = await this.isSystemImageInstalled(systemImage);
    if (isInstalled) {
      this.logger.info('System image already installed', { systemImage });
      return;
    }

    // Need to download system image
    this.logger.info('Downloading system image...', { systemImage });
    await this.downloadSystemImage(systemImage);
  }

  private async isSystemImageInstalled(systemImage: string): Promise<boolean> {
    // Convert system image identifier to path
    // e.g., "system-images;android-35;google_apis_playstore;arm64-v8a" -> "system-images/android-35/google_apis_playstore/arm64-v8a"
    const imagePath = systemImage.replace(/;/g, '/');
    const fullPath = path.join(this.config.androidSdkRoot, imagePath);

    return existsSync(fullPath);
  }

  private async downloadSystemImage(systemImage: string): Promise<void> {
    // Check sdkmanager exists
    if (!existsSync(this.config.sdkmanagerPath)) {
      throw new SniaffError(
        ErrorCode.SDKMANAGER_NOT_FOUND,
        `sdkmanager not found at: ${this.config.sdkmanagerPath}`,
        { path: this.config.sdkmanagerPath }
      );
    }

    try {
      // Accept licenses first
      this.logger.info('Accepting Android SDK licenses...');
      try {
        await execPromise(`yes | ${this.config.sdkmanagerPath} --licenses`, {
          timeout: 60000,
        });
      } catch {
        // License acceptance might fail if already accepted, that's okay
      }

      // Download system image
      this.logger.info('Downloading system image (this may take a while)...', { systemImage });
      const { stdout, stderr } = await execPromise(
        `${this.config.sdkmanagerPath} "${systemImage}"`,
        { timeout: 600000 } // 10 minutes timeout
      );

      this.logger.info('System image download completed', { stdout: stdout.slice(0, 500) });

      // Verify installation
      const isInstalled = await this.isSystemImageInstalled(systemImage);
      if (!isInstalled) {
        throw new SniaffError(
          ErrorCode.SYSTEM_IMAGE_DOWNLOAD_FAILED,
          'System image download completed but image not found',
          { systemImage, stderr }
        );
      }
    } catch (error) {
      if (error instanceof SniaffError) throw error;

      const err = error as Error;
      throw new SniaffError(
        ErrorCode.SYSTEM_IMAGE_DOWNLOAD_FAILED,
        `Failed to download system image: ${err.message}`,
        { systemImage }
      );
    }
  }

  private async createAvd(avdName: string, systemImage: string): Promise<void> {
    this.logger.info('Creating AVD', { avdName, systemImage });

    // Check avdmanager exists
    if (!existsSync(this.config.avdmanagerPath)) {
      throw new SniaffError(
        ErrorCode.AVDMANAGER_NOT_FOUND,
        `avdmanager not found at: ${this.config.avdmanagerPath}`,
        { path: this.config.avdmanagerPath }
      );
    }

    try {
      // Create AVD with small_phone device profile
      // Using echo "no" to decline custom hardware profile
      const command = `echo "no" | ${this.config.avdmanagerPath} create avd -n "${avdName}" -d "small_phone" -k "${systemImage}"`;

      this.logger.info('Running avdmanager create', { command });

      const { stdout, stderr } = await execPromise(command, {
        timeout: 120000, // 2 minutes
      });

      this.logger.info('AVD created successfully', {
        avdName,
        stdout: stdout.slice(0, 500),
      });

      // Verify AVD was created
      const exists = await this.avdExists(avdName);
      if (!exists) {
        throw new SniaffError(
          ErrorCode.AVD_CREATE_FAILED,
          'AVD creation completed but AVD not found',
          { avdName, stderr }
        );
      }
    } catch (error) {
      if (error instanceof SniaffError) throw error;

      const err = error as Error;
      throw new SniaffError(
        ErrorCode.AVD_CREATE_FAILED,
        `Failed to create AVD: ${err.message}`,
        { avdName, systemImage }
      );
    }
  }

  private async rootAvd(systemImage: string): Promise<void> {
    this.logger.info('Rooting AVD with rootAVD', { systemImage });

    // Check rootAVD script exists
    if (!existsSync(this.config.rootAvdPath)) {
      throw new SniaffError(
        ErrorCode.ROOTAVD_NOT_FOUND,
        `rootAVD script not found at: ${this.config.rootAvdPath}`,
        { path: this.config.rootAvdPath }
      );
    }

    // Build ramdisk path from system image
    // e.g., "system-images;android-35;google_apis_playstore;arm64-v8a" -> "system-images/android-35/google_apis_playstore/arm64-v8a/ramdisk.img"
    const imagePath = systemImage.replace(/;/g, '/');
    const ramdiskPath = path.join(imagePath, 'ramdisk.img');

    try {
      // First, we need to start the emulator so rootAVD can connect via ADB
      this.logger.info('Starting emulator for rooting process...');

      // Start emulator in background
      const emulatorProcess = await this.startEmulatorForRooting();

      try {
        // Wait for emulator to boot
        await this.waitForEmulatorBoot();

        // Run rootAVD script
        // The script expects to be run from the SDK root directory
        this.logger.info('Running rootAVD script...', { ramdiskPath });

        const rootAvdDir = path.dirname(this.config.rootAvdPath);
        const rootAvdScript = path.basename(this.config.rootAvdPath);

        // rootAVD needs to run from SDK root, passing the ramdisk path
        // We use 'yes' to auto-select default Magisk version
        const command = `cd "${this.config.androidSdkRoot}" && yes "" | "${this.config.rootAvdPath}" "${ramdiskPath}"`;

        this.logger.info('Executing rootAVD', { command });

        const { stdout, stderr } = await execPromise(command, {
          timeout: 300000, // 5 minutes
          env: {
            ...process.env,
            ANDROID_HOME: this.config.androidSdkRoot,
            ANDROID_SDK_ROOT: this.config.androidSdkRoot,
          },
        });

        this.logger.info('rootAVD completed', {
          stdout: stdout.slice(-1000), // Last 1000 chars
        });
      } finally {
        // Always stop the emulator after rooting
        await this.stopEmulatorForRooting(emulatorProcess);
      }
    } catch (error) {
      if (error instanceof SniaffError) throw error;

      const err = error as Error;
      throw new SniaffError(
        ErrorCode.ROOTAVD_FAILED,
        `Failed to root AVD: ${err.message}`,
        { systemImage, ramdiskPath }
      );
    }
  }

  private async startEmulatorForRooting(): Promise<number> {
    const avdName = this.config.sniaffAvdName;

    this.logger.info('Starting emulator for rooting', { avdName });

    const info = await this.supervisor.spawn(
      this.config.emulatorPath,
      ['-avd', avdName, '-port', '5554', '-no-snapshot-save'],
      {
        onStdout: (data) => this.logger.debug('Emulator stdout', { data: data.toString() }),
        onStderr: (data) => this.logger.debug('Emulator stderr', { data: data.toString() }),
      }
    );

    return info.pid;
  }

  private async waitForEmulatorBoot(): Promise<void> {
    const deviceId = 'emulator-5554';
    const timeout = 120000; // 2 minutes
    const startTime = Date.now();

    this.logger.info('Waiting for emulator to boot for rooting', { deviceId });

    // Wait for device to appear
    while (Date.now() - startTime < timeout) {
      try {
        const { stdout } = await execPromise(`${this.config.adbPath} devices`);
        if (stdout.includes(deviceId)) {
          break;
        }
      } catch {
        // Continue waiting
      }
      await this.delay(2000);
    }

    // Wait for boot completion
    while (Date.now() - startTime < timeout) {
      try {
        const { stdout } = await execPromise(
          `${this.config.adbPath} -s ${deviceId} shell getprop sys.boot_completed`
        );
        if (stdout.trim() === '1') {
          this.logger.info('Emulator booted for rooting');
          return;
        }
      } catch {
        // Continue waiting
      }
      await this.delay(2000);
    }

    throw new SniaffError(
      ErrorCode.EMULATOR_BOOT_TIMEOUT,
      'Emulator boot timed out during rooting setup',
      { deviceId, timeout }
    );
  }

  private async stopEmulatorForRooting(pid: number): Promise<void> {
    this.logger.info('Stopping emulator after rooting', { pid });

    try {
      // Try graceful shutdown via ADB first
      await execPromise(`${this.config.adbPath} -s emulator-5554 emu kill`);
      await this.delay(3000);
    } catch {
      // Ignore errors, we'll force kill if needed
    }

    try {
      await this.supervisor.kill(pid);
    } catch {
      // Process might already be dead
    }
  }

  /**
   * Delete an existing AVD completely.
   * Used when root check fails and we need to start fresh.
   */
  async deleteAvd(avdName: string): Promise<void> {
    this.logger.info('Deleting AVD', { avdName });

    // Check if AVD exists first
    const exists = await this.avdExists(avdName);
    if (!exists) {
      this.logger.info('AVD does not exist, nothing to delete', { avdName });
      return;
    }

    // Check avdmanager exists
    if (!existsSync(this.config.avdmanagerPath)) {
      throw new SniaffError(
        ErrorCode.AVDMANAGER_NOT_FOUND,
        `avdmanager not found at: ${this.config.avdmanagerPath}`,
        { path: this.config.avdmanagerPath }
      );
    }

    try {
      const command = `${this.config.avdmanagerPath} delete avd -n "${avdName}"`;
      this.logger.info('Running avdmanager delete', { command });

      const { stdout, stderr } = await execPromise(command, {
        timeout: 60000, // 1 minute
      });

      this.logger.info('AVD deleted successfully', {
        avdName,
        stdout: stdout.slice(0, 500),
      });

      // Verify AVD was deleted
      const stillExists = await this.avdExists(avdName);
      if (stillExists) {
        throw new SniaffError(
          ErrorCode.AVD_DELETE_FAILED,
          'AVD deletion completed but AVD still exists',
          { avdName, stderr }
        );
      }
    } catch (error) {
      if (error instanceof SniaffError) throw error;

      const err = error as Error;
      throw new SniaffError(
        ErrorCode.AVD_DELETE_FAILED,
        `Failed to delete AVD: ${err.message}`,
        { avdName }
      );
    }
  }

  /**
   * Force recreate AVD: delete existing + create + root.
   * Used when root check fails post-boot.
   */
  async forceRecreateAvd(): Promise<AvdSetupResult> {
    const avdName = this.config.sniaffAvdName;
    const systemImage = this.config.sniaffSystemImage;

    this.logger.info('Force recreating SniaffPhone AVD', { avdName, systemImage });

    // Step 1: Delete existing AVD if it exists
    await this.deleteAvd(avdName);

    // Step 2: Ensure system image is installed
    await this.ensureSystemImage(systemImage);

    // Step 3: Create the AVD
    await this.createAvd(avdName, systemImage);

    // Step 4: Root the AVD with rootAVD
    await this.rootAvd(systemImage);

    this.logger.info('SniaffPhone AVD force recreation completed', { avdName });

    return {
      avdName,
      wasCreated: true,
      wasRooted: true,
      systemImage,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
