import { spawn } from 'child_process';
import chalk from 'chalk';
import { DAEMON_BASE_URL } from './constants.js';
import { configManager } from './config.js';

export class DaemonClient {
  static async isRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${DAEMON_BASE_URL}/status`);
      return res.ok;
    } catch {
      return false;
    }
  }

  static async startDaemon(timeout?: number): Promise<void> {
    console.log(chalk.gray('Starting background daemon...'));

    // Get timeout from parameter or config
    const daemonTimeout = timeout || configManager.getDaemonTimeout();

    // Use process.argv[1] which points to the CLI entry point
    // detached: true allows the child to keep running after parent exits
    const subprocess = spawn(process.execPath, [process.argv[1], 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore',
      env: process.env
    });

    subprocess.unref();

    // Wait for daemon to be ready
    const start = Date.now();
    while (Date.now() - start < daemonTimeout) {
      if (await this.isRunning()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`Daemon failed to start within ${daemonTimeout / 1000}s timeout`);
  }

  static async ensureDaemon(timeout?: number): Promise<void> {
    if (await this.isRunning()) {
      return;
    }
    await this.startDaemon(timeout);
  }

  static async executeTool(serverName: string, toolName: string, args: any) {
    const response = await fetch(`${DAEMON_BASE_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: serverName, tool: toolName, args }),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Daemon error');
    }

    const data = await response.json();
    return data.result;
  }

  static async listTools(serverName: string) {
    const response = await fetch(`${DAEMON_BASE_URL}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: serverName }),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Daemon error');
    }

    const data = await response.json();
    // The daemon returns { tools: [...] }
    return data.tools || [];
  }
}
