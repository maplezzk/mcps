import { McpClientService } from './client.js';
import { configManager } from './config.js';

export class ConnectionPool {
  private clients: Map<string, McpClientService> = new Map();
  private pending = new Map<string, Promise<McpClientService>>();
  private connectingClients = new Map<string, McpClientService>();
  private failures = new Map<string, string>();
  private initializing = false;
  private initialized = false;

  async getClient(serverName: string, options?: { timeoutMs?: number }): Promise<McpClientService> {
    const serverConfig = configManager.getServer(serverName);
    if (!serverConfig) {
      throw new Error(`Server "${serverName}" not found in config.`);
    }
    if (serverConfig.disabled) throw new Error(`Server "${serverName}" is disabled.`);
    if (this.clients.has(serverName)) return this.clients.get(serverName)!;
    if (this.pending.has(serverName)) return this.pending.get(serverName)!;

    const client = new McpClientService();
    this.connectingClients.set(serverName, client);
    const connecting = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const connection = client.connect(serverConfig, serverName);
        if (options?.timeoutMs) {
          await Promise.race([connection, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Connection timeout after ${options.timeoutMs}ms`)), options.timeoutMs);
          })]);
        } else await connection;
        if (this.connectingClients.get(serverName) !== client) throw new Error('Connection was reset while connecting');
        this.clients.set(serverName, client);
        this.failures.delete(serverName);
        return client;
      } catch (error) {
        if (this.connectingClients.get(serverName) === client) this.failures.set(serverName, error instanceof Error ? error.message : String(error));
        await client.close();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        if (this.connectingClients.get(serverName) === client) {
          this.pending.delete(serverName);
          this.connectingClients.delete(serverName);
        }
      }
    })();
    this.pending.set(serverName, connecting);
    return connecting;
  }

  async closeClient(serverName: string) {
    const client = this.clients.get(serverName) ?? this.connectingClients.get(serverName);
    this.clients.delete(serverName);
    this.connectingClients.delete(serverName);
    this.pending.delete(serverName);
    this.failures.delete(serverName);
    if (client) {
      console.log(`[Daemon] Closing connection to ${serverName}...`);
      try {
        await client.close();
      } catch (e) {
        console.error(`[Daemon] Error closing ${serverName}:`, e);
      }
      return true;
    }
    return false;
  }

  async closeAll() {
    const verbose = process.env.MCPS_VERBOSE === 'true';
    if (verbose) {
      console.log('closeAll() called');
    }
    const closing = new Map([...this.connectingClients, ...this.clients]);
    this.clients.clear();
    this.connectingClients.clear();
    this.pending.clear();
    this.failures.clear();
    for (const [name, client] of closing) {
      console.log(`Closing connection to ${name}...`);
      try {
        await client.close();
      } catch (e) {
        console.error(`Error closing ${name}:`, e);
      }
    }
    if (verbose) {
      console.log('Connection pools cleared');
    }
  }

  async initializeAll() {
    const servers = configManager.listServers();
    this.initializing = true;
    this.initialized = false;

    const verbose = process.env.MCPS_VERBOSE === 'true';

    // 获取连接超时时间（从环境变量或默认 20 秒）
    const configuredTimeout = Number(process.env.MCPS_CONNECTION_TIMEOUT ?? 20000);
    const connectionTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20000;

    // 过滤掉 disabled 的服务器
    const enabledServers = servers.filter(server => {
      const disabled = (server as any).disabled === true;
      if (verbose && disabled) {
        console.log(`Skipping disabled server: ${server.name}`);
      }
      return !disabled;
    });

    if (enabledServers.length === 0) {
      console.log('No enabled servers to initialize.');
      this.initializing = false;
      this.initialized = true;
      return;
    }

    console.log(`Connecting to ${enabledServers.length} server(s)...`);
    const results: { name: string; success: boolean; error?: string }[] = [];

    for (const server of enabledServers) {
        process.stdout.write(`- ${server.name}... `);
        try {
            await this.getClient(server.name, { timeoutMs: connectionTimeout });
            results.push({ name: server.name, success: true });
            console.log('Connected ✓');
        } catch (error: any) {
            // Extract clean error message
            let errorMsg = 'Unknown error';
            if (error?.message) {
                // For spawn errors, the message usually contains the essential info
                errorMsg = error.message;
            } else if (typeof error === 'string') {
                errorMsg = error;
            } else if (error) {
                errorMsg = String(error);
            }

            results.push({ name: server.name, success: false, error: errorMsg });
            console.log('Failed ✗');
            if (verbose) {
                console.error(`Error: ${errorMsg}`);
            }
        }
    }

    // Print summary
    const successCount = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    console.log(`Connected: ${successCount}/${enabledServers.length}`);

    if (failed.length > 0) {
        console.log('Failed connections:');
        failed.forEach(f => {
            console.log(`  ✗ ${f.name}: ${f.error}`);
        });
    }

    this.initializing = false;
    this.initialized = true;
  }

  getInitStatus() {
    return { initializing: this.initializing, initialized: this.initialized };
  }

  async getActiveConnectionDetails(includeTools = true) {
    const details = [];
    for (const [name, client] of this.clients) {
      let toolsCount = null;
      let status = 'connected';

      if (includeTools) {
        try {
          const result = await client.listTools();
          toolsCount = result.tools.length;
        } catch {
          status = 'error';
        }
      }

      details.push({ name, toolsCount, status, ...client.getInfo() });
    }
    for (const [name, error] of this.failures) details.push({ name, toolsCount: null, status: 'error', error });
    return details;
  }
}

export const connectionPool = new ConnectionPool();
