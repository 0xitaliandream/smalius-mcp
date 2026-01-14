import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Project root is one level up from src/
const PROJECT_ROOT = path.resolve(__dirname, '..');

export interface Config {
  workspacesDir: string;
  logsDir: string;
  emulatorPath: string;
  adbPath: string;
  avdmanagerPath: string;
  sdkmanagerPath: string;
  rootAvdPath: string;
  androidSdkRoot: string;
  defaultEmulatorPort: number;
  defaultBootTimeout: number;
  bootPollInterval: number;
  maxSessions: number;
  portRetryAttempts: number;
  sniaffAvdName: string;
  sniaffSystemImage: string;
}

export function loadConfig(): Config {
  const androidSdkRoot =
    process.env.ANDROID_SDK_ROOT ||
    process.env.ANDROID_HOME ||
    path.join(os.homedir(), 'Library', 'Android', 'sdk');

  return {
    workspacesDir:
      process.env.SNIAFF_WORKSPACES_DIR ||
      path.join(os.homedir(), '.sniaff', 'workspaces'),
    logsDir:
      process.env.SNIAFF_LOGS_DIR || path.join(os.homedir(), '.sniaff', 'logs'),
    emulatorPath: process.env.SNIAFF_EMULATOR_PATH || 'emulator',
    adbPath: process.env.SNIAFF_ADB_PATH || 'adb',
    avdmanagerPath:
      process.env.SNIAFF_AVDMANAGER_PATH ||
      path.join(androidSdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    sdkmanagerPath:
      process.env.SNIAFF_SDKMANAGER_PATH ||
      path.join(androidSdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'),
    rootAvdPath:
      process.env.SNIAFF_ROOTAVD_PATH ||
      path.join(PROJECT_ROOT, 'rootAVD-master', 'rootAVD.sh'),
    androidSdkRoot,
    defaultEmulatorPort: parseInt(process.env.SNIAFF_EMULATOR_PORT || '5554', 10),
    defaultBootTimeout: parseInt(process.env.SNIAFF_BOOT_TIMEOUT || '120000', 10),
    bootPollInterval: parseInt(process.env.SNIAFF_BOOT_POLL_INTERVAL || '2000', 10),
    maxSessions: parseInt(process.env.SNIAFF_MAX_SESSIONS || '10', 10),
    portRetryAttempts: parseInt(process.env.SNIAFF_PORT_RETRY_ATTEMPTS || '5', 10),
    sniaffAvdName: process.env.SNIAFF_AVD_NAME || 'SniaffPhone',
    sniaffSystemImage:
      process.env.SNIAFF_SYSTEM_IMAGE ||
      'system-images;android-35;google_apis_playstore;arm64-v8a',
  };
}
