import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SmaliusError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export function registerLongPressTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'smalius.long_press',
    'Long press on a specific coordinate on the Android emulator screen. Useful for context menus, drag operations, etc.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by smalius.start'),
      x: z.number().int().min(0).describe('X coordinate in pixels'),
      y: z.number().int().min(0).describe('Y coordinate in pixels'),
      durationMs: z
        .number()
        .int()
        .min(500)
        .max(10000)
        .default(1000)
        .describe('Press duration in milliseconds (default: 1000, min: 500)'),
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

        // Long press is implemented as a swipe from the same point to the same point
        try {
          await execPromise(
            `${config.adbPath} -s ${deviceId} shell input swipe ${args.x} ${args.y} ${args.x} ${args.y} ${args.durationMs}`
          );
        } catch (error) {
          const err = error as Error;
          throw new SmaliusError(
            ErrorCode.ADB_COMMAND_FAILED,
            `Failed to long press: ${err.message}`,
            { deviceId, x: args.x, y: args.y, duration: args.durationMs }
          );
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  action: 'long_press',
                  x: args.x,
                  y: args.y,
                  durationMs: args.durationMs,
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
