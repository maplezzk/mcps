import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServerConfig } from '../types/config.js';
import { EventSource } from 'eventsource';

// Required for SSEClientTransport in Node.js environment
// @ts-ignore
global.EventSource = EventSource;

const resolveEnvPlaceholders = (input: string) => {
  const missing = new Set<string>();
  const resolved = input.replace(/\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (match, braced, bare) => {
    const key = braced || bare;
    const val = process.env[key];
    if (val === undefined) {
      missing.add(key);
      return match;
    }
    return val;
  });
  if (missing.size > 0) {
    const list = Array.from(missing).join(', ');
    throw new Error(`Missing environment variables: ${list}`);
  }
  return resolved;
};

export class McpClientService {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;

  async connect(config: ServerConfig) {
    try {
      if (config.type === 'stdio') {
        const resolvedConfigEnv: Record<string, string> = {};
        if (config.env) {
          for (const key in config.env) {
            const val = config.env[key];
            if (typeof val === 'string') {
              resolvedConfigEnv[key] = resolveEnvPlaceholders(val);
            }
          }
        }

        const rawEnv = config.env ? { ...process.env, ...resolvedConfigEnv } : process.env;
        const env: Record<string, string> = {};
        for (const key in rawEnv) {
            const val = rawEnv[key];
            if (typeof val === 'string') {
                env[key] = val;
            }
        }

        const args = config.args ? config.args.map(arg => resolveEnvPlaceholders(arg)) : [];
        this.transport = new StdioClientTransport({
          command: config.command,
          args,
          env: env,
        });
      } else if (config.type === 'http') {
        const url = resolveEnvPlaceholders(config.url);
        this.transport = new StreamableHTTPClientTransport(new URL(url));
      } else {
        const url = resolveEnvPlaceholders(config.url);
        this.transport = new SSEClientTransport(new URL(url));
      }

      this.client = new Client(
        {
          name: 'mcp-cli',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
    } catch (error) {
      // Error will be handled by the caller
      throw error;
    }
  }

  async listTools() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.listTools();
  }

  async callTool(toolName: string, args: any) {
    if (!this.client) throw new Error('Client not connected');
    return this.client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  async close() {
    if (this.transport) {
      await this.transport.close();
    }
  }
}
