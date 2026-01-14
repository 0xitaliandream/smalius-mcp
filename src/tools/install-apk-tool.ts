import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SniaffError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export function registerInstallApkTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'sniaff.install_apk',
    'Install an APK file on the Android emulator. Supports reinstall and automatic runtime permission granting.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by sniaff.start'),
      apkPath: z
        .string()
        .min(1)
        .describe(
          'Path to the APK file. Can be absolute or relative to the session workspace'
        ),
      reinstall: z
        .boolean()
        .default(true)
        .describe('Use -r flag to allow reinstall over existing app (default: true)'),
      grantRuntimePermissions: z
        .boolean()
        .default(true)
        .describe('Use -g flag to grant all runtime permissions (default: true)'),
      timeoutSec: z
        .number()
        .int()
        .min(10)
        .max(600)
        .default(180)
        .describe('Timeout in seconds (default: 180, max: 600)'),
    },
    async (args) => {
      try {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) {
          throw new SniaffError(
            ErrorCode.SESSION_NOT_FOUND,
            `Session '${args.sessionId}' not found`
          );
        }

        const deviceId = `emulator-${session.adbPort - 1}`;
        const timeoutMs = args.timeoutSec * 1000;

        // Resolve APK path (absolute or relative to workspace)
        let resolvedApkPath = args.apkPath;
        if (!path.isAbsolute(args.apkPath)) {
          resolvedApkPath = path.join(session.workspacePath, args.apkPath);
        }

        // Check if APK exists
        try {
          await fs.access(resolvedApkPath);
        } catch {
          throw new SniaffError(ErrorCode.APK_NOT_FOUND, `APK file not found: ${resolvedApkPath}`, {
            apkPath: args.apkPath,
            resolvedPath: resolvedApkPath,
          });
        }

        // Try to extract package name using aapt (optional, best-effort)
        let packageName: string | null = null;
        try {
          const aaptResult = await execPromise(`aapt dump badging "${resolvedApkPath}" | grep package:`, {
            timeout: 10000,
          });
          const match = aaptResult.stdout.match(/name='([^']+)'/);
          if (match) {
            packageName = match[1];
          }
        } catch {
          // aapt not available or failed, try apkanalyzer
          try {
            const analyzerResult = await execPromise(
              `apkanalyzer manifest application-id "${resolvedApkPath}"`,
              { timeout: 10000 }
            );
            packageName = analyzerResult.stdout.trim();
          } catch {
            // Both methods failed, package_name will be null
          }
        }

        // Build adb install command with flags
        const installFlags: string[] = [];
        if (args.reinstall) {
          installFlags.push('-r');
        }
        if (args.grantRuntimePermissions) {
          installFlags.push('-g');
        }

        const flagsStr = installFlags.length > 0 ? installFlags.join(' ') + ' ' : '';
        const adbCommand = `${config.adbPath} -s ${deviceId} install ${flagsStr}"${resolvedApkPath}"`;

        let stdout = '';
        let stderr = '';

        try {
          const result = await execPromise(adbCommand, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (error) {
          const err = error as Error & {
            code?: number | string;
            stdout?: string;
            stderr?: string;
            killed?: boolean;
          };

          if (err.killed) {
            throw new SniaffError(
              ErrorCode.TIMEOUT,
              `APK installation timed out after ${args.timeoutSec} seconds`,
              { deviceId, apkPath: resolvedApkPath, timeout: args.timeoutSec }
            );
          }

          stdout = err.stdout || '';
          stderr = err.stderr || '';

          // Check for specific failure patterns
          const output = stdout + stderr;
          const failureMatch = output.match(/Failure \[([^\]]+)\]/);
          const failureReason = failureMatch ? failureMatch[1] : 'Unknown error';

          throw new SniaffError(
            ErrorCode.APK_INSTALL_FAILED,
            `APK installation failed: ${failureReason}`,
            {
              deviceId,
              apkPath: resolvedApkPath,
              packageName,
              failureReason,
              stdout: stdout.trimEnd(),
              stderr: stderr.trimEnd(),
            }
          );
        }

        // Check if install actually succeeded
        if (!stdout.includes('Success')) {
          const failureMatch = (stdout + stderr).match(/Failure \[([^\]]+)\]/);
          const failureReason = failureMatch ? failureMatch[1] : 'Unknown error';

          throw new SniaffError(
            ErrorCode.APK_INSTALL_FAILED,
            `APK installation failed: ${failureReason}`,
            {
              deviceId,
              apkPath: resolvedApkPath,
              packageName,
              stdout: stdout.trimEnd(),
              stderr: stderr.trimEnd(),
            }
          );
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  packageName,
                  stdout: stdout.trimEnd(),
                  stderr: stderr.trimEnd(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const sniaffError =
          error instanceof SniaffError
            ? error
            : new SniaffError(
                ErrorCode.INTERNAL_ERROR,
                error instanceof Error ? error.message : String(error),
                { originalError: error instanceof Error ? error.stack : undefined }
              );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: false,
                  error: sniaffError.toJSON(),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
