import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SniaffError, ErrorCode } from '../types/errors.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Common Android key codes
const KEY_CODES: Record<string, number> = {
  // Navigation
  HOME: 3,
  BACK: 4,
  MENU: 82,
  APP_SWITCH: 187, // Recent apps

  // Media
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  VOLUME_MUTE: 164,
  POWER: 26,

  // D-pad
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,

  // Actions
  ENTER: 66,
  TAB: 61,
  SPACE: 62,
  DEL: 67, // Backspace
  FORWARD_DEL: 112,
  ESCAPE: 111,

  // Keyboard shortcuts
  SEARCH: 84,
  CAMERA: 27,

  // Function keys
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F11: 141,
  F12: 142,
};

export function registerKeyEventTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'sniaff.key_event',
    'Send a key event to the Android emulator. Supports common keys like BACK, HOME, ENTER, etc., or raw key codes.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by sniaff.start'),
      key: z
        .string()
        .min(1)
        .describe(
          'Key name (e.g., "BACK", "HOME", "ENTER", "VOLUME_UP", "DEL") or numeric key code (e.g., "66" for Enter)'
        ),
      longPress: z
        .boolean()
        .default(false)
        .describe('Send as long press event (default: false)'),
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

        // Resolve key code
        let keyCode: number;
        const upperKey = args.key.toUpperCase();

        if (KEY_CODES[upperKey] !== undefined) {
          keyCode = KEY_CODES[upperKey];
        } else if (/^\d+$/.test(args.key)) {
          keyCode = parseInt(args.key, 10);
        } else {
          throw new SniaffError(
            ErrorCode.INVALID_ARGUMENT,
            `Unknown key: "${args.key}". Use a key name (BACK, HOME, ENTER, etc.) or numeric key code.`,
            {
              key: args.key,
              availableKeys: Object.keys(KEY_CODES),
            }
          );
        }

        // Build command
        const longPressArg = args.longPress ? ' --longpress' : '';
        const command = `${config.adbPath} -s ${deviceId} shell input keyevent${longPressArg} ${keyCode}`;

        await execPromise(command, { timeout: 10000 });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  key: args.key,
                  keyCode,
                  longPress: args.longPress,
                  message: `Key event sent: ${args.key} (code: ${keyCode})${args.longPress ? ' [long press]' : ''}`,
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
