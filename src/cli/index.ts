#!/usr/bin/env node
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { StorageEngine } from '../storage/engine.js';
import { IntelligenceLayer } from '../intelligence/layer.js';
import { GitIntegration } from '../git/integration.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { SessionManager } from '../session/manager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('ClaudeMemoryCLI');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Initialize subsystems for CLI commands
let storage: StorageEngine;
let intelligence: IntelligenceLayer;
let git: GitIntegration;
let workspaceManager: WorkspaceManager;
let sessionManager: SessionManager;

async function initializeSubsystems() {
  try {
    // Initialize storage
    storage = new StorageEngine(config.storage);
    await storage.initialize();

    // Initialize git integration 
    git = new GitIntegration(config.git);
    await git.initialize();

    // Initialize workspace manager
    workspaceManager = new WorkspaceManager(git);

    // Initialize session manager with config and database
    sessionManager = new SessionManager({
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      maxActiveSessions: 10,
      persistSessions: true
    }, storage.getDatabase() || undefined);

    // Initialize intelligence layer
    intelligence = new IntelligenceLayer(config.intelligence, storage);
    await intelligence.initialize();
  } catch (error) {
    logger.error('Failed to initialize subsystems:', error);
    process.exit(1);
  }
}

// Command handlers
async function handleInjectContext(args: string[]) {
  await initializeSubsystems();
  
  // Parse arguments
  const options: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      if (key) options[key] = value || 'true';
    }
  }

  try {
    // Get current workspace using WorkspaceManager
    const workspacePath = await detectWorkspace();
    const workspaceId = await workspaceManager.detectWorkspace(workspacePath);
    
    // Get or create session using SessionManager
    const session = await sessionManager.getOrCreateSession(workspaceId, options.session);
    const sessionId = session.id;
    
    // Build query from context
    const query = options.prompt || options.tool || 'general context';
    
    // Retrieve relevant memories
    const memories = await intelligence.retrieveMemories(query, {
      filters: {
        workspaceId,
        sessionId: options['include-all-sessions'] ? undefined : sessionId
      },
      limit: 10
    });
    
    // Build and output context
    const context = await intelligence.buildContext(memories);
    
    // Output as MCP-compatible format
    console.log(JSON.stringify({
      type: 'context',
      workspaceId,
      sessionId,
      context,
      memoryCount: memories.length
    }));
    
  } catch (error) {
    logger.error('Failed to inject context:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

async function handleCaptureEvent(args: string[]) {
  await initializeSubsystems();
  
  // Parse arguments
  const options: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      if (key) options[key] = value || 'true';
    }
  }

  try {
    // Get current workspace using WorkspaceManager
    const workspacePath = await detectWorkspace();
    const workspaceId = await workspaceManager.detectWorkspace(workspacePath);
    
    // Get or create session using SessionManager
    const session = await sessionManager.getOrCreateSession(workspaceId, options.session);
    const sessionId = session.id;
    
    // Get git state
    const gitState = await git.getCurrentState();
    
    // Build memory from hook data
    const memory = {
      eventType: options.tool ? `tool_${options.tool}` : 'manual_capture',
      content: options.content || JSON.stringify(options),
      metadata: {
        tool: options.tool,
        status: options.status,
        ...options
      },
      timestamp: new Date(),
      sessionId,
      workspaceId,
      gitBranch: gitState.branch,
      gitCommit: gitState.commit
    };
    
    // Capture memory
    const captured = await storage.captureMemory(memory);
    
    // Output confirmation
    console.log(JSON.stringify({
      type: 'captured',
      memoryId: captured.id,
      workspaceId,
      sessionId
    }));
    
  } catch (error) {
    logger.error('Failed to capture event:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

function handleMCPServer() {
  // Start the MCP server in a subprocess
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      MEMORY_MODE: 'production'
    }
  });

  child.on('error', (error) => {
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

// Helper functions
async function detectWorkspace(): Promise<string> {
  try {
    const gitState = await git.getCurrentState();
    if (gitState.repository) {
      // Use git repository root as workspace
      return gitState.repository;
    }
  } catch (error) {
    logger.debug('Git workspace detection failed:', error);
  }
  
  // Fallback to current directory
  return process.cwd();
}


async function cleanup() {
  try {
    await storage?.close();
    sessionManager?.close(); // SessionManager close() is synchronous
    await git?.close();
    await intelligence?.close();
  } catch (error) {
    logger.error('Cleanup error:', error);
  }
}

// Main CLI logic
async function main() {
  if (!command) {
    // No command specified, run as MCP server
    handleMCPServer();
  } else {
    switch (command) {
      case 'inject-context':
        await handleInjectContext(args);
        break;
      case 'capture-event':
        await handleCaptureEvent(args);
        break;
      case 'server':
        handleMCPServer();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Available commands: inject-context, capture-event, server');
        process.exit(1);
    }
  }
}

// Handle process signals
process.on('SIGINT', () => {
  cleanup().then(() => process.exit(0)).catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  cleanup().then(() => process.exit(0)).catch(() => process.exit(1));
});

// Run main
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});