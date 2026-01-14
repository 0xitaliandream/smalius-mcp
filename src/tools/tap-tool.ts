import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SmaliusError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export function registerTapTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'smalius.tap',
    'Tap on a specific coordinate on the Android emulator screen. Use ui_dump to find element coordinates first.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by smalius.start'),
      x: z.number().int().min(0).describe('X coordinate in pixels'),
      y: z.number().int().min(0).describe('Y coordinate in pixels'),
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

        try {
          await execPromise(
            `${config.adbPath} -s ${deviceId} shell input tap ${args.x} ${args.y}`
          );
        } catch (error) {
          const err = error as Error;
          throw new SmaliusError(
            ErrorCode.ADB_COMMAND_FAILED,
            `Failed to tap: ${err.message}`,
            { deviceId, x: args.x, y: args.y }
          );
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  action: 'tap',
                  x: args.x,
                  y: args.y,
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
