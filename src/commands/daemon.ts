import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import chalk from 'chalk';
import { Command } from 'commander';
import { connectionPool } from '../core/pool.js';
import { createRequire } from 'module';
import { DAEMON_PORT } from '../core/constants.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

// Check if a port is in use
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(true); // Port is in use
    });

    server.once('listening', () => {
      server.once('close', () => {
        resolve(false); // Port is available
      });
      server.close();
    });

    server.listen(port, '127.0.0.1');
  });
}

// Action functions for daemon commands
const startAction = async (options: any) => {
  const port = parseInt(options.port || process.env.MCPS_PORT || DAEMON_PORT);

  // Check if port is in use (more reliable than HTTP check)
  const portInUse = await isPortInUse(port);
  if (portInUse) {
    // Try to check if it's our daemon via HTTP
    try {
      const res = await fetch(`http://localhost:${port}/status`);
      if (res.ok) {
        console.log(chalk.yellow(`Daemon is already running on port ${port}.`));
        process.exit(0);
        return;
      }
    } catch {
      // Port is in use but not our daemon
      console.error(chalk.red(`Port ${port} is already in use by another process.`));
      process.exit(1);
      return;
    }
  }

  // If we are already detached (indicated by env var), run the server
  if (process.env.MCPS_DAEMON_DETACHED === 'true') {
       startDaemon(port);
       return;
  }

  // Otherwise, spawn a detached process
  console.log(chalk.cyan('Starting daemon in background...'));
  let childFailed = false;
  const subprocess = spawn(process.execPath, [process.argv[1], 'daemon', 'start'], {
      detached: true,
      // Pipe stdout/stderr so we can see initialization logs
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
          ...process.env,
          MCPS_DAEMON_DETACHED: 'true'
      }
  });

  // Stream logs to current console while waiting for ready
  if (subprocess.stdout) {
      subprocess.stdout.on('data', (data) => {
          process.stdout.write(`[Daemon] ${data}`);
      });
  }
  if (subprocess.stderr) {
      subprocess.stderr.on('data', (data) => {
          const msg = data.toString();
          process.stderr.write(chalk.red(`[Daemon] ${msg}`));
          // Detect port conflict in child process
          if (msg.includes('Port') && msg.includes('is already in use')) {
              childFailed = true;
          }
      });
  }

  subprocess.unref();

  // Wait briefly to ensure it started (optional but good UX)
  // We can poll status for a second
  const start = Date.now();
  // Increased timeout to allow for connection initialization
  while (Date.now() - start < 10000) {
      // If child reported port conflict, check if daemon is actually running
      if (childFailed) {
          const stillRunning = await isPortInUse(port);
          if (stillRunning) {
              // Another daemon is running
              console.log(chalk.yellow(`\nDaemon is already running on port ${port}.`));
              process.exit(0);
              return;
          }
      }

      try {
          const res = await fetch(`http://localhost:${port}/status`);
          if (res.ok) {
              const data = await res.json();
              if (data.initialized) {
                  console.log(chalk.green(`Daemon started successfully on port ${port}.`));
                  process.exit(0);
              }
          }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
  }
  console.log(chalk.yellow('Daemon started (async check timeout, but likely running).'));
  process.exit(0);
};

const stopAction = async (options?: any) => {
   try {
     const port = parseInt(options?.port || process.env.MCPS_PORT || DAEMON_PORT);
     await fetch(`http://localhost:${port}/stop`, { method: 'POST' });
     console.log(chalk.green('Daemon stopped successfully.'));
   } catch (e) {
     console.error(chalk.red('Failed to stop daemon. Is it running?'));
   }
};

const statusAction = async (options?: any) => {
   try {
     const port = parseInt(options?.port || process.env.MCPS_PORT || DAEMON_PORT);
     const res = await fetch(`http://localhost:${port}/status`);
     const data = await res.json();
     console.log(chalk.green(`Daemon is running (v${data.version})`));
     if (data.connections && data.connections.length > 0) {
        console.log(chalk.bold('\nActive Connections:'));
        data.connections.forEach((conn: any) => {
            const count = conn.toolsCount !== null ? `(${conn.toolsCount} tools)` : (data.initializing ? '(initializing)' : '(error listing tools)');
            const status = conn.status === 'error' ? chalk.red('[Error]') : '';
            console.log(chalk.cyan(`- ${conn.name} ${chalk.gray(count)} ${status}`));
        });
     } else {
         console.log(chalk.gray('No active connections.'));
     }
   } catch (e) {
     console.error(chalk.red('Daemon is not running.'));
   }
};

const restartAction = async (serverName: string | undefined, options?: any) => {
   try {
     const port = parseInt(options?.port || process.env.MCPS_PORT || DAEMON_PORT);
     const res = await fetch(`http://localhost:${port}/restart`, {
        method: 'POST',
        body: JSON.stringify({ server: serverName })
     });
     const data = await res.json();
     console.log(chalk.green(data.message));
   } catch (e) {
     console.error(chalk.red('Failed to restart. Is the daemon running?'));
   }
};

export const registerDaemonCommand = (program: Command) => {
  // ===== Top-level commands (new, simplified) =====

  program.command('start')
    .description('Start the daemon')
    .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
    .action((options) => startAction(options));

  program.command('stop')
    .description('Stop the daemon')
    .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
    .action((options) => stopAction(options));

  program.command('status')
    .description('Check daemon status')
    .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
    .action((options) => statusAction(options));

  program.command('restart [server]')
    .description('Restart the daemon or a specific server connection')
    .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
    .action((serverName, options) => restartAction(serverName, options));

  // ===== Legacy daemon subcommands (for backward compatibility) =====

  const daemonCmd = program.command('daemon')
    .description('Manage the mcps daemon (legacy, use top-level commands)')
    .usage('start|stop|restart|status')
    .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT));

  daemonCmd.command('start', { isDefault: true, hidden: true })
    .description('Start the daemon (default)')
    .action((options) => startAction(options));

  daemonCmd.command('stop')
    .description('Stop the running daemon')
    .action((options) => stopAction(options));

  daemonCmd.command('status')
    .description('Check daemon status')
    .action((options) => statusAction(options));

  daemonCmd.command('restart [server]')
    .description('Restart the daemon or a specific server connection')
    .action((serverName, options) => restartAction(serverName, options));
};

const startDaemon = (port: number) => {
      const server = http.createServer(async (req, res) => {
    // Basic Error Handling
    req.on('error', (err) => {
        console.error('[Daemon] Request error:', err);
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === 'GET' && req.url === '/status') {
          const initStatus = connectionPool.getInitStatus();
          const connections = await connectionPool.getActiveConnectionDetails(!initStatus.initializing);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
              status: 'running', 
              version: pkg.version,
              connections,
              ...initStatus
          }));
          return;
        }
        
        // ... (restart/stop/call handlers) ...
        if (req.method === 'POST' && req.url === '/restart') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
               try {
                 const { server: serverName } = JSON.parse(body || '{}');
                 
                 if (serverName) {
                   const closed = await connectionPool.closeClient(serverName);
                   res.writeHead(200, { 'Content-Type': 'application/json' });
                   res.end(JSON.stringify({ message: `Server "${serverName}" connection closed. It will be reconnected on next call.`, closed }));
                 } else {
                   await connectionPool.closeAll();
                   res.writeHead(200, { 'Content-Type': 'application/json' });
                   res.end(JSON.stringify({ message: 'All connections closed.' }));
                 }
               } catch (error: any) {
                 res.writeHead(500, { 'Content-Type': 'application/json' });
                 res.end(JSON.stringify({ error: error.message }));
               }
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/stop') {
             res.writeHead(200, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ message: 'Daemon shutting down...' }));
             setTimeout(() => {
               server.close();
               connectionPool.closeAll();
               process.exit(0);
             }, 100);
             return;
        }

        if (req.method === 'POST' && req.url === '/call') {
          let body = '';
          req.on('data', chunk => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { server: serverName, tool, args } = JSON.parse(body);
              
              if (!serverName || !tool) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing server or tool' }));
                return;
              }

              const client = await connectionPool.getClient(serverName);
              const result = await client.callTool(tool, args || {});

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ result }));
            } catch (error: any) {
              console.error(`[Daemon] Error executing tool:`, error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
            }
          });
          return;
        }

        if (req.method === 'POST' && req.url === '/list') {
          let body = '';
          req.on('data', chunk => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const { server: serverName } = JSON.parse(body);
              
              if (!serverName) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing server name' }));
                return;
              }

              const client = await connectionPool.getClient(serverName);
              const toolsResult = await client.listTools();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(toolsResult));
            } catch (error: any) {
              console.error(`[Daemon] Error listing tools:`, error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
            }
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      server.listen(port, async () => {
        // Initialize all connections eagerly
        try {
          await connectionPool.initializeAll();
        } catch (error: any) {
          console.error('[Daemon] Error during initialization:', error.message);
          // Don't exit, continue running with partial connections
        }
      });
      
      server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          console.error(chalk.red(`Port ${port} is already in use by another daemon.`));
          process.exit(1); // Exit with error if port is in use
        } else {
          console.error('[Daemon] Server error:', e);
          process.exit(1);
        }
      });

      const shutdown = async () => {
        console.log('\n[Daemon] Shutting down...');
        server.close();
        await connectionPool.closeAll();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Prevent unhandled rejections from crashing the daemon
      process.on('unhandledRejection', (reason, promise) => {
        console.error('[Daemon] Unhandled Rejection at:', promise, 'reason:', reason);
      });
};
