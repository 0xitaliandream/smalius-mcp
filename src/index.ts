#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { Logger } from './utils/logger.js';
import { SessionManager } from './core/session-manager.js';
import { registerStartTool } from './tools/start-tool.js';
import { registerUiDumpTool } from './tools/ui-dump-tool.js';
import { registerShellTool } from './tools/shell-tool.js';
import { registerTapTool } from './tools/tap-tool.js';
import { registerSwipeTool } from './tools/swipe-tool.js';
import { registerLongPressTool } from './tools/long-press-tool.js';
import { registerInstallApkTool } from './tools/install-apk-tool.js';
import { registerScreenshotTool } from './tools/screenshot-tool.js';
import { registerSetProxyTool } from './tools/set-proxy-tool.js';
import { registerRemoveProxyTool } from './tools/remove-proxy-tool.js';
import { registerInputTextTool } from './tools/input-text-tool.js';
import { registerKeyEventTool } from './tools/key-event-tool.js';
import { registerInstallMitmCertTool } from './tools/install-mitm-cert-tool.js';

async function main() {
  // Load configuration
  const config = loadConfig();

  // Initialize logger
  const logger = new Logger({
    logDir: config.logsDir,
    name: 'sniaff-android-mcp',
  });

  logger.info('Starting sniaff-android-mcp server');

  // Initialize session manager
  const sessionManager = new SessionManager({
    config,
    logger,
  });

  // Create MCP server
  const server = new McpServer({
    name: 'sniaff-android-mcp',
    version: '0.1.0',
  });

  // Register tools
  registerStartTool(server, sessionManager);
  registerUiDumpTool(server, sessionManager, config);
  registerShellTool(server, sessionManager, config);
  registerTapTool(server, sessionManager, config);
  registerSwipeTool(server, sessionManager, config);
  registerLongPressTool(server, sessionManager, config);
  registerInstallApkTool(server, sessionManager, config);
  registerScreenshotTool(server, sessionManager, config);
  registerSetProxyTool(server, sessionManager, config);
  registerRemoveProxyTool(server, sessionManager, config);
  registerInputTextTool(server, sessionManager, config);
  registerKeyEventTool(server, sessionManager, config);
  registerInstallMitmCertTool(server, sessionManager, config);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Server connected via stdio transport');

  // Handle graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Received shutdown signal, cleaning up...', { signal });

    // Stop all active sessions (kills emulator processes)
    for (const session of sessionManager.getAllSessions()) {
      try {
        await sessionManager.stopSession(session.sessionId);
        logger.info('Stopped session', { sessionId: session.sessionId });
      } catch (error) {
        logger.error('Failed to stop session during shutdown', {
          sessionId: session.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      await server.close();
    } catch {
      // Ignore close errors
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  // Handle various termination signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle stdin close (client disconnected)
  process.stdin.on('close', () => {
    logger.info('stdin closed, client disconnected');
    shutdown('stdin-close');
  });

  // Handle stdin end
  process.stdin.on('end', () => {
    logger.info('stdin ended, client disconnected');
    shutdown('stdin-end');
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
