import { McpClientService } from './client.js';
import { configManager } from './config.js';
import { ServerConfig } from '../types/config.js';

export class ConnectionPool {
  private clients: Map<string, McpClientService> = new Map();
  private toolsCache: Map<string, number> = new Map();
  private initializing = false;
  private initialized = false;

  async getClient(serverName: string, options?: { timeoutMs?: number }): Promise<McpClientService> {
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    const serverConfig = configManager.getServer(serverName);
    if (!serverConfig) {
      throw new Error(`Server "${serverName}" not found in config.`);
    }

    const client = new McpClientService();
    const connectPromise = client.connect(serverConfig);
    if (options?.timeoutMs) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Connection timeout after ${options.timeoutMs}ms`)), options.timeoutMs);
      });
      await Promise.race([connectPromise, timeoutPromise]);
    } else {
      await connectPromise;
    }
    this.clients.set(serverName, client);

    // Cache tools count after connection
    try {
      const result = await client.listTools();
      this.toolsCache.set(serverName, result.tools.length);
    } catch (e) {
      // Connection succeeded but listTools failed, cache as 0
      this.toolsCache.set(serverName, 0);
    }

    return client;
  }

  async closeClient(serverName: string) {
    if (this.clients.has(serverName)) {
      console.log(`[Daemon] Closing connection to ${serverName}...`);
      try {
        await this.clients.get(serverName)!.close();
      } catch (e) {
        console.error(`[Daemon] Error closing ${serverName}:`, e);
      }
      this.clients.delete(serverName);
      this.toolsCache.delete(serverName);
      return true;
    }
    return false;
  }

  async closeAll() {
    for (const [name, client] of this.clients) {
      console.log(`[Daemon] Closing connection to ${name}...`);
      try {
        client.close(); // 同步调用，不使用 await
      } catch (e) {
        console.error(`[Daemon] Error closing ${name}:`, e);
      }
    }
    this.clients.clear();
    this.toolsCache.clear();
  }

  async initializeAll() {
    const servers = configManager.listServers();
    this.initializing = true;
    this.initialized = false;

    const verbose = process.env.MCPS_VERBOSE === 'true';

    // 过滤掉 disabled 的服务器
    const enabledServers = servers.filter(server => {
      const disabled = (server as any).disabled === true;
      if (verbose && disabled) {
        console.log(`[Daemon] Skipping disabled server: ${server.name}`);
      }
      return !disabled;
    });

    if (enabledServers.length === 0) {
      console.log('[Daemon] No enabled servers to initialize.');
      this.initializing = false;
      this.initialized = true;
      return;
    }

    console.log(`[Daemon] Connecting to ${enabledServers.length} server(s)...`);
    const results: { name: string; success: boolean; error?: string }[] = [];

    for (const server of enabledServers) {
        process.stdout.write(`[Daemon] - ${server.name}... `);
        try {
            await this.getClient(server.name, { timeoutMs: 8000 });
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
                console.error(`[Daemon] Error: ${errorMsg}`);
            }
        }
    }

    // Print summary
    const successCount = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);
    console.log(`[Daemon] Connected: ${successCount}/${enabledServers.length}`);

    if (failed.length > 0) {
        console.log('[Daemon] Failed connections:');
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

  async getActiveConnectionDetails(includeTools = true): Promise<{ name: string, toolsCount: number | null, status: string }[]> {
    const details = [];
    for (const [name, client] of this.clients) {
      let toolsCount = null;
      let status = 'connected';

      if (includeTools) {
        // Use cached tools count instead of calling listTools again
        if (this.toolsCache.has(name)) {
          toolsCount = this.toolsCache.get(name)!;
        } else {
          // Fallback: if not cached, fetch it now
          try {
            const result = await client.listTools();
            toolsCount = result.tools.length;
            this.toolsCache.set(name, toolsCount);
          } catch (e) {
            status = 'error';
          }
        }
      }

      details.push({ name, toolsCount, status });
    }
    return details;
  }
}

export const connectionPool = new ConnectionPool();
