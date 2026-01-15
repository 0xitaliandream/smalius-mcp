import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionManager } from '../core/session-manager.js';
import { Config } from '../config.js';
import { SniaffError, ErrorCode } from '../types/errors.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export function registerInstallMitmCertTool(
  server: McpServer,
  sessionManager: SessionManager,
  config: Config
): void {
  server.tool(
    'sniaff.install_mitm_cert',
    'Opens mitm.it in the browser to install the mitmproxy CA certificate. The proxy must be configured first with sniaff.set_proxy. IMPORTANT: After calling this tool, you MUST ask the user to install the certificate and wait for their confirmation before proceeding.',
    {
      sessionId: z.string().min(1).describe('The session ID returned by sniaff.start'),
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

        // Open mitm.it in the default browser
        const openCommand = `${config.adbPath} -s ${deviceId} shell am start -a android.intent.action.VIEW -d "http://mitm.it"`;
        await execPromise(openCommand, { timeout: 10000 });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  action: 'REQUIRES_USER_ACTION',
                  message: 'Browser opened to mitm.it. ASK THE USER to install the certificate and confirm when done.',
                  instructions: [
                    '1. Tap on "Android" on the mitm.it page',
                    '2. The certificate file will download',
                    '3. Open the downloaded file and install the CA certificate',
                    '4. If prompted, name it "mitmproxy" and select "VPN and apps" for credential use',
                    '5. Confirm to the assistant when installation is complete',
                  ],
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
