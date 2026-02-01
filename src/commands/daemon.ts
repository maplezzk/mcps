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

// Helper function to make HTTP requests to daemon (bypassing proxy)
function daemonRequest(method: string, path: string, body?: string): Promise<{ status: number; ok: boolean; data: any }> {
  return new Promise((resolve, reject) => {
    const port = parseInt(process.env.MCPS_PORT || String(DAEMON_PORT));
    const options = {
      method,
      hostname: '127.0.0.1',
      port,
      path,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 500,
            ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
            data: data ? JSON.parse(data) : {},
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

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

  // Get timeout from option, env, or config (in seconds)
  let timeout = 30; // Default 30 seconds for daemon start
  if (options.timeout) {
    timeout = parseInt(options.timeout, 10);
  } else if (process.env.MCPS_DAEMON_TIMEOUT) {
    timeout = parseInt(process.env.MCPS_DAEMON_TIMEOUT, 10);
  }

  // Check if port is in use (more reliable than HTTP check)
  const portInUse = await isPortInUse(port);
  if (portInUse) {
    // Try to check if it's our daemon via HTTP
    try {
      const { ok } = await daemonRequest('GET', '/status');
      if (ok) {
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

  // Create log file paths
  const logDir = '/tmp/mcps-daemon';
  const stdoutLog = `${logDir}/stdout.log`;
  const stderrLog = `${logDir}/stderr.log`;

  // Ensure log directory exists
  const fs = await import('fs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Clear old log files for fresh start
  if (fs.existsSync(stdoutLog)) {
    fs.truncateSync(stdoutLog, 0);
  }
  if (fs.existsSync(stderrLog)) {
    fs.truncateSync(stderrLog, 0);
  }

  // Open file descriptors for stdout and stderr
  const stdoutFd = fs.openSync(stdoutLog, 'a');
  const stderrFd = fs.openSync(stderrLog, 'a');

  const subprocess = spawn(process.execPath, [process.argv[1], 'daemon', 'start'], {
      detached: true,
      // Pipe stdout/stderr to log files
      stdio: ['ignore', stdoutFd, stderrFd],
      env: {
          ...process.env,
          MCPS_DAEMON_DETACHED: 'true',
          MCPS_VERBOSE: options.verbose ? 'true' : 'false'
      }
  });

  subprocess.unref();

  // Wait briefly to ensure it started (optional but good UX)
  // We can poll status for a second
  const start = Date.now();
  // Use timeout from option/env (convert to ms)
  let lastLogSize = 0;  // Track last read position to avoid duplicate logs

  while (Date.now() - start < timeout * 1000) {
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

      // Show only new logs (avoid duplicates)
      try {
          if (fs.existsSync(stdoutLog)) {
              const { size } = fs.statSync(stdoutLog);
              if (size > lastLogSize) {
                  // Read new logs only
                  const buffer = Buffer.alloc(size - lastLogSize);
                  const fd = fs.openSync(stdoutLog, 'r');
                  fs.readSync(fd, buffer, 0, size - lastLogSize, lastLogSize);
                  fs.closeSync(fd);

                  const newLogs = buffer.toString('utf-8');
                  newLogs.split('\n').forEach(line => {
                      if (line.trim()) process.stdout.write(line + '\n');
                  });

                  lastLogSize = size;
              }
          }
      } catch (e) {
          // Ignore log read errors
      }

      try {
          const { ok, data } = await daemonRequest('GET', '/status');
          if (ok && data.initialized) {
              console.log(chalk.green(`Daemon started successfully on port ${port}.`));
              console.log(chalk.gray(`Logs: ${stdoutLog}`));
              process.exit(0);
          }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
  }
  console.log(chalk.yellow('Daemon started (async check timeout, but likely running).'));
  console.log(chalk.gray(`Logs: ${stdoutLog}`));
  process.exit(0);
};

const stopAction = async (options?: any) => {
   try {
     await daemonRequest('POST', '/stop');
     console.log(chalk.green('Daemon stopped successfully.'));
   } catch (e) {
     console.error(chalk.red('Failed to stop daemon. Is it running?'));
   }
};

const statusAction = async (options?: any) => {
   try {
     const { data } = await daemonRequest('GET', '/status');

     console.log('');
     console.log(chalk.green(`Daemon is running (v${data.version})`));

     if (data.connections && data.connections.length > 0) {
        // Helper function to calculate display width (Chinese chars count as 2)
        const getDisplayWidth = (str: string): number => {
            let width = 0;
            for (const char of str) {
                if (char.charCodeAt(0) > 127) {
                    width += 2;
                } else {
                    width += 1;
                }
            }
            return width;
        };

        // Helper function to pad string considering Chinese characters
        const padEndWidth = (str: string, targetWidth: number): string => {
            const displayWidth = getDisplayWidth(str);
            const padding = Math.max(0, targetWidth - displayWidth);
            return str + ' '.repeat(padding);
        };

        // Build table rows
        const rows = data.connections.map((conn: any) => {
            const statusText = conn.status === 'error' ? 'Error' : 'Connected';
            const statusColor = conn.status === 'error' ? chalk.red : chalk.green;
            const toolsCount = conn.toolsCount !== null ? conn.toolsCount : '-';

            return {
                name: conn.name,
                status: statusColor(statusText),
                tools: toolsCount
            };
        });

        // Calculate column widths
        const nameWidth = Math.max(4, ...rows.map((r: any) => getDisplayWidth(r.name)));
        const statusWidth = 10;
        const toolsWidth = 6;

        // Print table header
        console.log(chalk.bold('\nActive Connections:'));
        console.log(chalk.bold(`${'NAME'.padEnd(nameWidth)}  ${'STATUS'.padEnd(statusWidth)}  ${'TOOLS'}`));
        console.log(chalk.cyan('─'.repeat(nameWidth) + '  ' + '─'.repeat(statusWidth) + '  ' + '─'.repeat(toolsWidth)));

        // Print table rows
        rows.forEach((row: any) => {
            console.log(`${padEndWidth(row.name, nameWidth)}  ${String(row.status).padEnd(statusWidth)}  ${String(row.tools)}`);
        });

        console.log(chalk.cyan(`Total: ${data.connections.length} connection(s)`));
     } else {
         console.log(chalk.yellow('\nNo active connections.'));
     }

     console.log('');
   } catch (e) {
     console.error(chalk.red('Daemon is not running.'));
   }
};

const restartAction = async (serverName: string | undefined, options?: any) => {
   try {
     const body = serverName ? JSON.stringify({ server: serverName }) : JSON.stringify({});

     // 启动日志显示（在后台读取守护进程日志）
     const logPath = '/tmp/mcps-daemon/stdout.log';
     const fs = await import('fs');

     // 发送 restart 请求
     const requestPromise = daemonRequest('POST', '/restart', body);

     // 在后台显示日志
     const showLogs = async () => {
       try {
         if (!fs.existsSync(logPath)) {
           return;
         }

         // 获取当前日志文件大小
         let lastSize = fs.statSync(logPath).size;

         // 等待请求完成，同时显示新日志
         const startTime = Date.now();
         const timeout = 30000; // 30秒超时

         while (Date.now() - startTime < timeout) {
           await new Promise(r => setTimeout(r, 200)); // 每200ms检查一次

           try {
             const { size: currentSize } = fs.statSync(logPath);
             if (currentSize > lastSize) {
               // 读取新增的日志内容
               const buffer = Buffer.alloc(currentSize - lastSize);
               const fd = fs.openSync(logPath, 'r');
               fs.readSync(fd, buffer, 0, currentSize - lastSize, lastSize);
               fs.closeSync(fd);

               const newLogs = buffer.toString('utf-8');
               // 只显示关闭和重启相关的日志
               const relevantLogs = newLogs.split('\n').filter(line => {
                 return line.includes('Closing connection to') ||
                        line.includes('Connected ✓') ||
                        line.includes('Connecting to') ||
                        line.includes('Connected: ') ||
                        line.trim().startsWith('- '); // 包含服务名行
               });

               if (relevantLogs.length > 0) {
                   // 检查是否已经完成
                   const hasCompletion = newLogs.includes('All servers reinitialized successfully');

                   relevantLogs.forEach(log => {
                     if (log.trim()) {
                       if (log.includes('Closing')) {
                         console.log(chalk.yellow(log));
                       } else if (log.includes('Connected ✓')) {
                         console.log(chalk.green(log));
                       } else if (log.includes('Connected:')) {
                         // 最终连接统计
                         console.log(chalk.green(log));
                       } else {
                         console.log(log);
                       }
                     }
                   });

                   if (hasCompletion) {
                     break; // 完成后退出
                   }

                   // 更新起始位置
                   lastSize = currentSize;
               }
             }
           } catch (e) {
             // 忽略读取错误
           }
         }
       } catch (e) {
         // 忽略日志显示错误
       }
     };

     // 同时执行请求和日志显示
     const [{ status, ok, data }] = await Promise.all([
       requestPromise,
       showLogs()
     ]);

     if (ok) {
       console.log(chalk.green(data.message));
     } else if (status === 404) {
       console.error(chalk.yellow(data.error || 'Server not found'));
     } else {
       console.error(chalk.red(data.error || 'Failed to restart'));
     }
   } catch (e: any) {
     console.error(chalk.red('Failed to restart.'));
     console.error(chalk.red(`Error: ${e.message}`));
     console.error(chalk.gray(`Stack: ${e.stack}`));
   }
};

export const registerDaemonCommand = (program: Command) => {
  // ===== Top-level commands (new, simplified) =====

  program.command('start')
    .description('Start the daemon')
    .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
    .option('-t, --timeout <seconds>', 'Startup timeout in seconds (default: 30)')
    .option('-v, --verbose', 'Show detailed logs')
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
    .option('-t, --timeout <seconds>', 'Startup timeout in seconds (default: 30)')
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
                 const verbose = process.env.MCPS_VERBOSE === 'true';

                 if (verbose) {
                   console.log(`[Daemon] Received restart request for: ${serverName || 'all servers'}`);
                 }

                 if (serverName) {
                   // Restart specific server connection
                   if (verbose) {
                     console.log(`[Daemon] Closing server: ${serverName}`);
                   }
                   const closed = await connectionPool.closeClient(serverName);
                   if (closed) {
                     // Reconnect to the specific server
                     try {
                       if (verbose) {
                         console.log(`[Daemon] Reconnecting to: ${serverName}`);
                       }
                       await connectionPool.getClient(serverName);
                       if (verbose) {
                         console.log(`[Daemon] Successfully restarted: ${serverName}`);
                       }
                       res.writeHead(200, { 'Content-Type': 'application/json' });
                       res.end(JSON.stringify({ message: `Server "${serverName}" restarted successfully.` }));
                     } catch (error: any) {
                       console.error(`[Daemon] Failed to reconnect to ${serverName}:`, error);
                       res.writeHead(500, { 'Content-Type': 'application/json' });
                       res.end(JSON.stringify({ error: `Failed to reconnect to "${serverName}": ${error.message}` }));
                     }
                   } else {
                     if (verbose) {
                       console.log(`[Daemon] Server not found: ${serverName}`);
                     }
                     res.writeHead(404, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ error: `Server "${serverName}" not found or not connected.` }));
                   }
                 } else {
                   // Restart all connections
                   console.log('Closing all connections...');
                   await connectionPool.closeAll();
                   console.log('All connections closed. Reinitializing...');
                   // Reinitialize all servers
                   await connectionPool.initializeAll();
                   console.log('All servers reinitialized successfully');
                   res.writeHead(200, { 'Content-Type': 'application/json' });
                   res.end(JSON.stringify({ message: 'All servers restarted successfully.' }));
                 }
               } catch (error: any) {
                 console.error('[Daemon] Error during restart:', error);
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

              // Try to use cached tools first
              const cachedTools = connectionPool.getCachedTools(serverName);
              if (cachedTools !== null) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ tools: cachedTools }));
                return;
              }

              // Fallback: fetch from client if not cached
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
