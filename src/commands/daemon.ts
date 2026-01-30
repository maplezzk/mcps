import http from 'http';
import chalk from 'chalk';
import { Command } from 'commander';
import { connectionPool } from '../core/pool.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const PORT = 4100;

export const registerDaemonCommand = (program: Command) => {
  const daemonCmd = program.command('daemon')
    .description('Manage the mcps daemon');

  daemonCmd.command('start', { isDefault: true })
    .description('Start the daemon (default)')
    .option('-p, --port <number>', 'Port to listen on', String(PORT))
    .action(async (options) => {
      const port = parseInt(options.port);
      // ... (server logic) ...
      // Need to move the server creation logic here or keep it in the main action if no subcommands match?
      // Commander handling of default commands with subcommands can be tricky.
      // Let's refactor to use separate actions.
      startDaemon(port);
    });

  daemonCmd.command('stop')
    .description('Stop the running daemon')
    .action(async () => {
       try {
         await fetch(`http://localhost:${PORT}/stop`, { method: 'POST' });
         console.log(chalk.green('Daemon stopped successfully.'));
       } catch (e) {
         console.error(chalk.red('Failed to stop daemon. Is it running?'));
       }
    });

  daemonCmd.command('status')
    .description('Check daemon status')
    .action(async () => {
       try {
         const res = await fetch(`http://localhost:${PORT}/status`);
         const data = await res.json();
         console.log(chalk.green(`Daemon is running (v${data.version})`));
          if (data.connections && data.connections.length > 0) {
             console.log(chalk.bold('\nActive Connections:'));
             data.connections.forEach((conn: any) => {
                 const count = conn.toolsCount !== null ? `(${conn.toolsCount} tools)` : '(error listing tools)';
                 const status = conn.status === 'error' ? chalk.red('[Error]') : '';
                 console.log(chalk.cyan(`- ${conn.name} ${chalk.gray(count)} ${status}`));
             });
          } else {
              console.log(chalk.gray('No active connections.'));
          }
       } catch (e) {
         console.error(chalk.red('Daemon is not running.'));
       }
    });

  daemonCmd.command('restart [server]')
    .description('Restart the daemon or a specific server connection')
    .action(async (serverName) => {
       try {
         const res = await fetch(`http://localhost:${PORT}/restart`, { 
            method: 'POST',
            body: JSON.stringify({ server: serverName })
         });
         const data = await res.json();
         console.log(chalk.green(data.message));
       } catch (e) {
         console.error(chalk.red('Failed to restart. Is the daemon running?'));
       }
    });
};

const startDaemon = (port: number) => {
      const server = http.createServer(async (req, res) => {
        // ... (middleware) ...
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === 'GET' && req.url === '/status') {
          const connections = await connectionPool.getActiveConnectionDetails();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
              status: 'running', 
              version: pkg.version,
              connections
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
              const tools = await client.listTools();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ tools }));
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

      server.listen(port, () => {
        console.log(chalk.green(`
🚀 mcps Daemon started on port ${port}
-----------------------------------
- Keeps connections to MCP servers alive
- Improves performance for frequent tool calls
- Run 'mcps call ...' in another terminal to use it automatically
        `));
      });

      const shutdown = async () => {
        console.log('\n[Daemon] Shutting down...');
        server.close();
        await connectionPool.closeAll();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
};
