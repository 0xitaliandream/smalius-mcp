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

// Counter for screenshot naming (per session)
const screenshotCounters = new Map<string, number>();

function getNextScreenshotNumber(sessionId: string): number {
  const current = screenshotCounters.get(sessionId) || 0;
  const next = current + 1;
  screenshotCounters.set(sessionId, next);
  return next;
}

export function registerScreenshotTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'sniaff.screenshot',
    'Capture a screenshot of the Android emulator screen and save it to the session workspace.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by sniaff.start'),
      label: z
        .string()
        .regex(/^[a-zA-Z0-9_-]*$/)
        .max(50)
        .optional()
        .describe('Optional label to include in filename (alphanumeric, underscore, hyphen only)'),
      format: z
        .enum(['png'])
        .default('png')
        .describe('Image format (currently only png supported)'),
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

        // Create screenshots directory in workspace
        const screenshotsDir = path.join(session.workspacePath, 'artifacts', 'screenshots');
        await fs.mkdir(screenshotsDir, { recursive: true });

        // Generate filename
        const shotNumber = getNextScreenshotNumber(args.sessionId);
        const paddedNumber = String(shotNumber).padStart(4, '0');
        const labelPart = args.label ? `_${args.label}` : '';
        const filename = `shot_${paddedNumber}${labelPart}.${args.format}`;
        const outputPath = path.join(screenshotsDir, filename);

        // Try exec-out method first (more reliable, no temp file)
        let screenshotSuccess = false;
        let errorDetails = '';

        try {
          // exec-out streams the PNG directly to stdout
          const adbCommand = `${config.adbPath} -s ${deviceId} exec-out screencap -p`;
          const result = await execPromise(adbCommand, {
            encoding: 'buffer',
            timeout: 30000,
            maxBuffer: 50 * 1024 * 1024, // 50MB for large screens
          });

          // Write buffer to file
          await fs.writeFile(outputPath, result.stdout);
          screenshotSuccess = true;
        } catch (error) {
          const err = error as Error;
          errorDetails = `exec-out method failed: ${err.message}`;
        }

        // Fallback to shell method if exec-out failed
        if (!screenshotSuccess) {
          try {
            const tempPath = '/sdcard/sniaff_screenshot.png';

            // Take screenshot on device
            await execPromise(`${config.adbPath} -s ${deviceId} shell screencap -p ${tempPath}`, {
              timeout: 30000,
            });

            // Pull to host
            await execPromise(`${config.adbPath} -s ${deviceId} pull ${tempPath} "${outputPath}"`, {
              timeout: 30000,
            });

            // Clean up temp file on device
            await execPromise(`${config.adbPath} -s ${deviceId} shell rm ${tempPath}`, {
              timeout: 5000,
            }).catch(() => {
              // Ignore cleanup errors
            });

            screenshotSuccess = true;
          } catch (error) {
            const err = error as Error;
            errorDetails += `; shell method failed: ${err.message}`;
          }
        }

        if (!screenshotSuccess) {
          throw new SniaffError(
            ErrorCode.SCREENSHOT_FAILED,
            `Failed to capture screenshot: ${errorDetails}`,
            { deviceId, outputPath }
          );
        }

        // Get image dimensions (best-effort)
        let width: number | null = null;
        let height: number | null = null;

        try {
          // Try using file command or identify (ImageMagick)
          const identifyResult = await execPromise(`file "${outputPath}"`, { timeout: 5000 });
          const match = identifyResult.stdout.match(/(\d+)\s*x\s*(\d+)/);
          if (match) {
            width = parseInt(match[1], 10);
            height = parseInt(match[2], 10);
          }
        } catch {
          // Dimensions not available, that's okay
        }

        // Return path relative to workspace
        const relativePath = path.relative(session.workspacePath, outputPath);

        const result: {
          ok: boolean;
          artifactPath: string;
          width?: number;
          height?: number;
        } = {
          ok: true,
          artifactPath: relativePath,
        };

        if (width !== null && height !== null) {
          result.width = width;
          result.height = height;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
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
