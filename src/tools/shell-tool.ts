import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SmaliusError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export function registerShellTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'smalius.shell',
    'Execute a shell command on the Android emulator and return stdout/stderr/exit code. Useful for running adb shell commands, getting device properties, or executing scripts on the device.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by smalius.start'),
      cmd: z.string().min(1).describe('The command to execute on the device'),
      timeoutSec: z
        .number()
        .int()
        .min(1)
        .max(300)
        .default(30)
        .describe('Timeout in seconds (default: 30, max: 300)'),
      asRoot: z
        .boolean()
        .default(false)
        .describe('Execute command as root using su -c (default: false)'),
      shell: z
        .enum(['sh', 'bash'])
        .default('sh')
        .describe('Shell to use: "sh" (default) or "bash" (best-effort)'),
    },
    async (args) => {
      try {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) {
          throw new SmaliusError(
            ErrorCode.SESSION_NOT_FOUND,
            `Session '${args.sessionId}' not found`
          );
        }

        const deviceId = `emulator-${session.adbPort - 1}`;
        const timeoutMs = args.timeoutSec * 1000;

        // Build the command
        let deviceCmd = args.cmd;

        // Wrap with root if requested
        if (args.asRoot) {
          // Escape single quotes in the command for su -c
          const escapedCmd = deviceCmd.replace(/'/g, "'\\''");
          deviceCmd = `su -c '${escapedCmd}'`;
        }

        // Wrap with shell if not sh
        if (args.shell === 'bash') {
          const escapedCmd = deviceCmd.replace(/'/g, "'\\''");
          deviceCmd = `bash -c '${escapedCmd}'`;
        }

        // Execute via adb shell
        const adbCommand = `${config.adbPath} -s ${deviceId} shell "${deviceCmd.replace(/"/g, '\\"')}"`;

        let stdout = '';
        let stderr = '';
        let exitCode = 0;

        try {
          const result = await execPromise(adbCommand, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (error) {
          const err = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };

          if (err.killed) {
            throw new SmaliusError(
              ErrorCode.ADB_COMMAND_FAILED,
              `Command timed out after ${args.timeoutSec} seconds`,
              { deviceId, cmd: args.cmd, timeout: args.timeoutSec }
            );
          }

          // Command executed but returned non-zero exit code
          stdout = err.stdout || '';
          stderr = err.stderr || '';
          exitCode = typeof err.code === 'number' ? err.code : 1;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  exitCode,
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
        const smaliusError =
          error instanceof SmaliusError
            ? error
            : new SmaliusError(
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
                  success: false,
                  error: smaliusError.toJSON(),
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
