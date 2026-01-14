import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SmaliusError, ErrorCode } from '../types/errors.js';

const execPromise = promisify(exec);

export function registerUiDumpTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'smalius.ui_dump',
    'Dump the current UI hierarchy from the Android emulator as XML. Useful for understanding the current screen state and finding UI elements for automation.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by smalius.start'),
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
        const timestamp = Date.now();
        const remoteFile = '/sdcard/ui_dump.xml';
        const localFileName = `ui_dump_${timestamp}.xml`;
        const localFilePath = path.join(session.workspacePath, localFileName);

        // Dump UI hierarchy on device
        try {
          await execPromise(
            `${config.adbPath} -s ${deviceId} shell uiautomator dump ${remoteFile}`
          );
        } catch (error) {
          const err = error as Error;
          throw new SmaliusError(
            ErrorCode.ADB_COMMAND_FAILED,
            `Failed to dump UI: ${err.message}`,
            { deviceId, command: 'uiautomator dump' }
          );
        }

        // Pull file from device
        try {
          await execPromise(
            `${config.adbPath} -s ${deviceId} pull ${remoteFile} "${localFilePath}"`
          );
        } catch (error) {
          const err = error as Error;
          throw new SmaliusError(
            ErrorCode.ADB_COMMAND_FAILED,
            `Failed to pull UI dump: ${err.message}`,
            { deviceId, remoteFile, localFilePath }
          );
        }

        // Read the XML content
        const xmlContent = await fs.readFile(localFilePath, 'utf-8');

        // Cleanup remote file (best-effort)
        try {
          await execPromise(`${config.adbPath} -s ${deviceId} shell rm ${remoteFile}`);
        } catch {
          // Ignore cleanup errors
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  filePath: localFilePath,
                  fileName: localFileName,
                  timestamp,
                },
                null,
                2
              ),
            },
            {
              type: 'text' as const,
              text: xmlContent,
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
