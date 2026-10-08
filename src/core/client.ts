import {
  Client, ClientCredentialsProvider, SSEClientTransport, StreamableHTTPClientTransport,
  type CallToolRequestParams, type CompleteRequestParams, type GetPromptRequestParams,
  type InputResponses, type RequestOptions,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRequire } from 'node:module';
import { ServerConfig, StdioServerConfig, HttpServerConfig, detectServerType } from '../types/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export const resolveEnvPlaceholders = (input: string) => {
  const missing = new Set<string>();
  const resolved = input.replace(/\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (match, braced, bare) => {
    const key = braced || bare;
    if (process.env[key] === undefined) {
      missing.add(key);
      return match;
    }
    return process.env[key]!;
  });
  if (missing.size) throw new Error(`Missing environment variables: ${[...missing].join(', ')}`);
  return resolved;
};

export type Continuation = { inputResponses?: InputResponses; requestState?: string };
export type ProtocolOperation =
  'info' | 'resources/list' | 'resources/templates/list' | 'resources/read' |
  'prompts/list' | 'prompts/get' | 'completion/complete';

export class McpClientService {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;
  private serverName = '';

  async connect(config: ServerConfig, serverName = '') {
    if (config.disabled) throw new Error(`Server "${serverName}" is disabled.`);
    this.serverName = serverName;
    const serverType = detectServerType(config);
    const configuredVersion = config.protocolVersion ?? 'auto';
    if (serverType === 'sse' && configuredVersion === '2026-07-28') {
      throw new Error('MCP 2026-07-28 requires stdio or Streamable HTTP; legacy SSE cannot use this revision.');
    }
    if (serverType === 'stdio' && 'command' in config) {
      const stdio = config as StdioServerConfig;
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
      for (const [key, value] of Object.entries(stdio.env ?? {})) env[key] = resolveEnvPlaceholders(value);
      this.transport = new StdioClientTransport({
        command: resolveEnvPlaceholders(stdio.command),
        args: stdio.args?.map(resolveEnvPlaceholders),
        cwd: stdio.cwd ? resolveEnvPlaceholders(stdio.cwd) : undefined,
        env,
      });
    } else if ('url' in config) {
      const http = config as HttpServerConfig;
      const headers = Object.fromEntries(Object.entries(http.headers ?? {}).map(([key, value]) => [key, resolveEnvPlaceholders(value)]));
      const url = new URL(resolveEnvPlaceholders(http.url));
      const requestInit = Object.keys(headers).length ? { headers } : {};
      let authProvider: ClientCredentialsProvider | undefined;
      if (http.auth) {
        const secret = process.env[http.auth.clientSecretEnv];
        if (!secret) throw new Error(`Missing environment variable: ${http.auth.clientSecretEnv}`);
        authProvider = new ClientCredentialsProvider({
          clientId: http.auth.clientId, clientSecret: secret,
          expectedIssuer: http.auth.issuer, scope: http.auth.scope,
        });
      }
      this.transport = serverType === 'http'
        ? new StreamableHTTPClientTransport(url, { requestInit, authProvider })
        : new SSEClientTransport(url, { requestInit, authProvider });
    } else {
      throw new Error('Invalid server configuration: expected command or url.');
    }

    const mode = serverType === 'sse' ? 'legacy' : configuredVersion;
    this.client = new Client({ name: 'mcps', version: pkg.version }, {
      versionNegotiation: {
        mode: mode === '2026-07-28' ? { pin: mode } : mode,
        probe: { timeoutMs: 2000, maxRetries: 0 },
      },
      // CLI users explicitly supply continuation responses; never auto-accept a server's form or URL request.
      capabilities: { elicitation: { form: {}, url: {} } },
      inputRequired: { autoFulfill: false },
      listChanged: {
        tools: { onChanged: () => {} },
        resources: { onChanged: () => {} },
        prompts: { onChanged: () => {} },
      },
    });
    // Legacy servers use an unsolicited request instead of an input_required result.
    // A background CLI daemon cannot collect consent interactively, so explicitly cancel it.
    this.client.setRequestHandler('elicitation/create', async () => ({ action: 'cancel' }));
    try {
      await this.client.connect(this.transport);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private connected() {
    if (!this.client) throw new Error('Client not connected');
    return this.client;
  }

  getInfo() {
    const client = this.connected();
    return {
      protocolVersion: client.getNegotiatedProtocolVersion(),
      protocolEra: client.getProtocolEra(),
      serverInfo: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
      instructions: client.getInstructions(),
      discovery: client.getDiscoverResult(),
    };
  }

  async listTools() {
    return this.connected().listTools();
  }

  async callTool(toolName: string, args: Record<string, unknown>, timeout?: number, continuation: Continuation = {}) {
    const options = { timeout, maxTotalTimeout: timeout, allowInputRequired: true };
    const params: CallToolRequestParams = { name: toolName, arguments: args, ...continuation };
    if (process.env.MCPS_VERBOSE === 'true') console.log(`[Tool Request] Server: ${this.serverName}, Tool: ${toolName}`);
    const result = await this.connected().callTool(params, options);
    if (process.env.MCPS_VERBOSE === 'true') console.log(`[Tool Response] Server: ${this.serverName}, Tool: ${toolName}`);
    return result;
  }

  async request(operation: ProtocolOperation, params: Record<string, unknown> = {}, timeout?: number) {
    const client = this.connected();
    const options: RequestOptions = { timeout, maxTotalTimeout: timeout, allowInputRequired: true };
    switch (operation) {
      case 'info': return this.getInfo();
      case 'resources/list': return client.listResources();
      case 'resources/templates/list': return client.listResourceTemplates();
      case 'resources/read':
        if (typeof params.uri !== 'string') throw new Error('Resource uri must be a string');
        return client.readResource({ uri: params.uri, ...params }, options);
      case 'prompts/list': return client.listPrompts();
      case 'prompts/get':
        if (typeof params.name !== 'string') throw new Error('Prompt name must be a string');
        return client.getPrompt(params as GetPromptRequestParams, options);
      case 'completion/complete': return client.complete(params as CompleteRequestParams, options);
      default: throw new Error(`Unsupported MCP operation: ${operation}`);
    }
  }

  async close() {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    // The SDK owns and reaps the exact stdio child; avoid matching/killing unrelated PIDs.
    if (client) await client.close();
    else if (transport) await transport.close();
  }
}
