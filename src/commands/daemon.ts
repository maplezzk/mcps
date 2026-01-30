import http from 'http';
import chalk from 'chalk';
import { Command } from 'commander';
import { connectionPool } from '../core/pool.js';

const PORT = 4100;

export const registerDaemonCommand = (program: Command) => {
  program.command('daemon')
    .description('Start the mcps daemon to keep server connections alive')
    .option('-p, --port <number>', 'Port to listen on', String(PORT))
    .action(async (options) => {
      const port = parseInt(options.port);

      const server = http.createServer(async (req, res) => {
        // Enable CORS for local dev usage if needed
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === 'GET' && req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'running', version: '1.0.0' }));
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

      // Handle shutdown
      const shutdown = async () => {
        console.log('\n[Daemon] Shutting down...');
        server.close();
        await connectionPool.closeAll();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
};
