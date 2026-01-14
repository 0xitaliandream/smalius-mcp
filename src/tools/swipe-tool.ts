import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SmaliusError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export function registerSwipeTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'smalius.swipe',
    'Swipe on the Android emulator screen. Can swipe by direction (from center) or by specifying exact coordinates.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by smalius.start'),
      direction: z
        .enum(['up', 'down', 'left', 'right'])
        .optional()
        .describe('Swipe direction from screen center (use this OR coordinates)'),
      startX: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Start X coordinate in pixels (use with startY, endX, endY)'),
      startY: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Start Y coordinate in pixels'),
      endX: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('End X coordinate in pixels'),
      endY: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('End Y coordinate in pixels'),
      durationMs: z
        .number()
        .int()
        .min(100)
        .max(5000)
        .default(500)
        .describe('Swipe duration in milliseconds (default: 500)'),
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

        let x0: number, y0: number, x1: number, y1: number;

        if (args.direction) {
          // Get screen size for directional swipe
          let screenWidth = 1080;
          let screenHeight = 1920;

          try {
            const { stdout } = await execPromise(
              `${config.adbPath} -s ${deviceId} shell wm size`
            );
            const match = stdout.match(/(\d+)x(\d+)/);
            if (match) {
              screenWidth = parseInt(match[1], 10);
              screenHeight = parseInt(match[2], 10);
            }
          } catch {
            // Use defaults if we can't get screen size
          }

          const centerX = Math.floor(screenWidth / 2);
          const centerY = Math.floor(screenHeight / 2);
          const swipeDistance = Math.floor(Math.min(screenWidth, screenHeight) * 0.4);

          switch (args.direction) {
            case 'up':
              x0 = centerX;
              y0 = centerY + swipeDistance;
              x1 = centerX;
              y1 = centerY - swipeDistance;
              break;
            case 'down':
              x0 = centerX;
              y0 = centerY - swipeDistance;
              x1 = centerX;
              y1 = centerY + swipeDistance;
              break;
            case 'left':
              x0 = centerX + swipeDistance;
              y0 = centerY;
              x1 = centerX - swipeDistance;
              y1 = centerY;
              break;
            case 'right':
              x0 = centerX - swipeDistance;
              y0 = centerY;
              x1 = centerX + swipeDistance;
              y1 = centerY;
              break;
          }
        } else if (
          args.startX !== undefined &&
          args.startY !== undefined &&
          args.endX !== undefined &&
          args.endY !== undefined
        ) {
          x0 = args.startX;
          y0 = args.startY;
          x1 = args.endX;
          y1 = args.endY;
        } else {
          throw new SmaliusError(
            ErrorCode.INVALID_ARGUMENT,
            'Must provide either direction OR all coordinates (startX, startY, endX, endY)'
          );
        }

        try {
          await execPromise(
            `${config.adbPath} -s ${deviceId} shell input swipe ${x0} ${y0} ${x1} ${y1} ${args.durationMs}`
          );
        } catch (error) {
          const err = error as Error;
          throw new SmaliusError(
            ErrorCode.ADB_COMMAND_FAILED,
            `Failed to swipe: ${err.message}`,
            { deviceId, x0, y0, x1, y1, duration: args.durationMs }
          );
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  action: 'swipe',
                  from: { x: x0, y: y0 },
                  to: { x: x1, y: y1 },
                  durationMs: args.durationMs,
                  direction: args.direction || null,
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
