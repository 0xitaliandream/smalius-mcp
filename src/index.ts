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

async function main() {
  // Load configuration
  const config = loadConfig();

  // Initialize logger
  const logger = new Logger({
    logDir: config.logsDir,
    name: 'smalius-mcp',
  });

  logger.info('Starting smalius-mcp server');

  // Initialize session manager
  const sessionManager = new SessionManager({
    config,
    logger,
  });

  // Create MCP server
  const server = new McpServer({
    name: 'smalius-mcp',
    version: '0.1.0',
  });

  // Register tools
  registerStartTool(server, sessionManager);
  registerUiDumpTool(server, sessionManager, config);
  registerShellTool(server, sessionManager, config);
  registerTapTool(server, sessionManager, config);
  registerSwipeTool(server, sessionManager, config);
  registerLongPressTool(server, sessionManager, config);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Server connected via stdio transport');

  // Handle graceful shutdown
  const cleanup = async () => {
    logger.info('Shutting down smalius-mcp');

    // Stop all active sessions
    for (const session of sessionManager.getAllSessions()) {
      try {
        await sessionManager.stopSession(session.sessionId);
      } catch (error) {
        logger.error('Failed to stop session during shutdown', {
          sessionId: session.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
