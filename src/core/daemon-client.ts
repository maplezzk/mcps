import { spawn } from 'node:child_process';
import http from 'node:http';
import { DAEMON_PORT } from './constants.js';
import { configManager } from './config.js';
import { type Continuation, type ProtocolOperation } from './client.js';

export async function daemonRequest(method: string, endpoint: string, body?: unknown, port = DAEMON_PORT, timeout = 300000): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: endpoint, method, headers: { 'Content-Type': 'application/json' } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if ((response.statusCode ?? 500) >= 400) {
            const error = new Error(parsed.error ?? 'Daemon request failed');
            Object.assign(error, { code: parsed.code, data: parsed.data });
            reject(error);
          } else resolve(parsed);
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(timeout, () => request.destroy(new Error('Daemon request timed out')));
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

export class DaemonClient {
  static async isRunning(): Promise<boolean> {
    try {
      const status = await daemonRequest('GET', '/status', undefined, DAEMON_PORT, 2000);
      return status.status === 'running' && status.configPath === configManager.getConfigPath();
    } catch { return false; }
  }

  static async startDaemon(timeout = configManager.getDaemonTimeout()): Promise<void> {
    console.error('Starting background daemon...');
    const subprocess = spawn(process.execPath, [...process.execArgv, process.argv[1], 'start'], {
      detached: true, stdio: 'ignore', env: process.env,
    });
    subprocess.unref();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const status = await daemonRequest('GET', '/status', undefined, DAEMON_PORT, 1000);
        if (status.configPath !== configManager.getConfigPath()) throw new Error('This daemon port belongs to a different configuration. Choose a different MCPS_PORT.');
        if (status.status === 'running' && status.initialized) return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('different configuration')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Daemon failed to initialize within ${timeout / 1000}s. Inspect the daemon logs.`);
  }

  static async ensureDaemon(timeout?: number) {
    if (!await this.isRunning()) await this.startDaemon(timeout);
  }

  static async executeTool(server: string, tool: string, args: any, timeout?: number, continuation: Continuation = {}) {
    const response = await daemonRequest('POST', '/call', { server, tool, args, timeout, ...continuation }, DAEMON_PORT, (timeout ?? 300000) + 5000);
    return response.result;
  }

  static async listTools(server: string) {
    const response = await daemonRequest('POST', '/list', { server });
    return response.tools;
  }

  static async request(server: string, operation: ProtocolOperation, params: Record<string, unknown> = {}, timeout = 300000) {
    const response = await daemonRequest('POST', '/protocol', { server, operation, params, timeout }, DAEMON_PORT, timeout + 5000);
    return response.result;
  }
}
