import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SniaffError, ErrorCode } from '../types/errors.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export function registerInputTextTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'sniaff.input_text',
    'Type text into the currently focused input field on the Android emulator. Useful for filling forms, search boxes, etc.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by sniaff.start'),
      text: z.string().min(1).describe('The text to type into the focused input field'),
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

        // Escape special characters for adb shell input text
        // Spaces need to be replaced with %s, and special chars escaped
        const escapedText = args.text
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/'/g, "\\'")
          .replace(/`/g, '\\`')
          .replace(/\$/g, '\\$')
          .replace(/&/g, '\\&')
          .replace(/;/g, '\\;')
          .replace(/\|/g, '\\|')
          .replace(/</g, '\\<')
          .replace(/>/g, '\\>')
          .replace(/\(/g, '\\(')
          .replace(/\)/g, '\\)')
          .replace(/ /g, '%s');

        const command = `${config.adbPath} -s ${deviceId} shell input text "${escapedText}"`;

        await execPromise(command, { timeout: 30000 });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  text: args.text,
                  message: `Text input sent: "${args.text}"`,
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
                ErrorCode.ADB_COMMAND_FAILED,
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
