import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { connectionPool } from '../core/pool.js';
import { configManager } from '../core/config.js';
import { daemonRequest } from '../core/daemon-client.js';
import { DAEMON_PORT } from '../core/constants.js';

const pkg = createRequire(import.meta.url)('../../package.json');
const fail = (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
};
const portNumber = (value: string | number) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer between 1 and 65535');
  return port;
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function portAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function startAction(options: any) {
  try {
    const port = portNumber(options.port);
    configManager.validateConfig();
    const timeout = options.timeout === undefined ? configManager.getDaemonTimeout() : Number(options.timeout) * 1000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Startup timeout must be positive');
    if (!await portAvailable(port)) {
      const status = await daemonRequest('GET', '/status', undefined, port, 2000);
      if (status.status !== 'running' || status.configPath !== configManager.getConfigPath()) throw new Error(`Port ${port} belongs to another service or configuration`);
      console.log(`Daemon is already running on port ${port}.`);
      return;
    }
    if (process.env.MCPS_DAEMON_DETACHED === 'true') {
      startDaemon(port);
      return;
    }
    const logDir = path.join(os.tmpdir(), 'mcps-daemon', String(port));
    fs.mkdirSync(logDir, { recursive: true });
    const stdoutLog = path.join(logDir, 'stdout.log');
    const stderrLog = path.join(logDir, 'stderr.log');
    const stdout = fs.openSync(stdoutLog, 'a');
    const stderr = fs.openSync(stderrLog, 'a');
    const connectionTimeout = Number(options.connectionTimeout ?? '20');
    if (!Number.isFinite(connectionTimeout) || connectionTimeout <= 0) throw new Error('Connection timeout must be positive');
    console.log('Starting daemon in background...');
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], 'start', '--port', String(port)], {
      detached: true, stdio: ['ignore', stdout, stderr],
      env: { ...process.env, MCPS_PORT: String(port), MCPS_DAEMON_DETACHED: 'true', MCPS_VERBOSE: String(Boolean(options.verbose)), MCPS_CONNECTION_TIMEOUT: String(connectionTimeout * 1000) },
    });
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    child.unref();
    let childError: Error | undefined;
    child.on('error', error => { childError = error; });
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (childError) throw childError;
      try {
        const status = await daemonRequest('GET', '/status', undefined, port, 1000);
        if (status.initialized && status.configPath === configManager.getConfigPath()) {
          console.log(`Daemon started successfully on port ${port}.`);
          console.log(`Logs: ${stdoutLog}, ${stderrLog}`);
          return;
        }
      } catch {}
      await delay(100);
    }
    throw new Error(`Daemon did not initialize within ${timeout / 1000}s. Inspect ${stderrLog}`);
  } catch (error) { fail(error); }
}

async function statusAction(options: any) {
  try {
    const status = await daemonRequest('GET', '/status', undefined, portNumber(options.port), 5000);
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(`Daemon is running (v${status.version})`);
    console.table(status.connections.map((connection: any) => ({
      NAME: connection.name, STATUS: connection.status, TOOLS: connection.toolsCount,
      PROTOCOL: connection.protocolVersion, ERA: connection.protocolEra,
    })));
  } catch (error) { fail(error); }
}

async function stopAction(options: any) {
  try {
    const result = await daemonRequest('POST', '/stop', undefined, portNumber(options.port), 10000);
    console.log(result.message);
  } catch (error) { fail(error); }
}

async function restartAction(server: string | undefined, options: any) {
  try {
    const result = await daemonRequest('POST', '/restart', { server }, portNumber(options.port));
    console.log(result.message);
  } catch (error) { fail(error); }
}

export function registerDaemonCommand(program: Command) {
  const register = (target: Command) => {
    target.command('start').description('Start the daemon')
      .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
      .option('-t, --timeout <seconds>', 'Startup timeout')
      .option('-c, --connection-timeout <seconds>', 'Server connection timeout', '20')
      .option('-v, --verbose', 'Show detailed logs').action(startAction);
    target.command('status').description('Inspect daemon connections and negotiated protocols')
      .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT))
      .option('-j, --json', 'Output complete status JSON').action(statusAction);
    target.command('stop').description('Stop the daemon')
      .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT)).action(stopAction);
    target.command('restart [server]').description('Restart server connections')
      .option('-p, --port <number>', 'Daemon port', String(DAEMON_PORT)).action(restartAction);
  };
  register(program);
  register(program.command('daemon').description('Legacy daemon subcommands'));
}

export function startDaemon(port: number) {
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const send = (status: number, body: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method === 'GET' && request.url === '/status') {
        const initialization = connectionPool.getInitStatus();
        send(200, { status: 'running', version: pkg.version, configPath: configManager.getConfigPath(), connections: await connectionPool.getActiveConnectionDetails(!initialization.initializing), ...initialization });
        return;
      }
      if (request.method !== 'POST') { send(404, { error: 'Unknown daemon endpoint' }); return; }
      let raw = '';
      for await (const chunk of request) raw += chunk.toString();
      let body: any;
      try { body = raw ? JSON.parse(raw) : {}; } catch { send(400, { error: 'Invalid request JSON' }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { send(400, { error: 'Request body must be an object' }); return; }
      if (request.url === '/stop') {
        await connectionPool.closeAll();
        send(200, { message: 'Daemon stopped successfully.' });
        setTimeout(() => { server.close(); process.exit(0); }, 100);
        return;
      }
      if (request.url === '/restart') {
        if (body.server) {
          await connectionPool.closeClient(body.server);
          await connectionPool.getClient(body.server);
        } else {
          await connectionPool.closeAll();
          await connectionPool.initializeAll();
        }
        send(200, { message: 'Server connections restarted.' });
        return;
      }
      if (!['/call', '/list', '/protocol'].includes(request.url ?? '')) { send(404, { error: 'Unknown daemon endpoint' }); return; }
      if (typeof body.server !== 'string' || !body.server) { send(400, { error: 'Server name is required' }); return; }
      const client = await connectionPool.getClient(body.server, { timeoutMs: 20000 });
      if (request.url === '/list') {
        send(200, await client.listTools());
      } else if (request.url === '/call') {
        if (typeof body.tool !== 'string' || !body.tool) { send(400, { error: 'Tool name is required' }); return; }
        const result = await client.callTool(body.tool, body.args ?? {}, body.timeout, { inputResponses: body.inputResponses, requestState: body.requestState });
        send(200, { result });
      } else {
        send(200, { result: await client.request(body.operation, body.params, body.timeout) });
      }
    } catch (error: any) {
      send(500, { error: error.message, code: error.code, data: error.data });
    }
  });
  server.listen(port, '127.0.0.1', async () => {
    try { await connectionPool.initializeAll(); } catch (error) { console.error(error); }
  });
  server.on('error', error => { console.error(error.message); process.exit(1); });
  const shutdown = async () => {
    await connectionPool.closeAll();
    server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('close', () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  });
  return server;
}
