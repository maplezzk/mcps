import { z } from 'zod';

const CommonServerFields = {
  protocolVersion: z.enum(['auto', 'legacy', '2026-07-28']).optional(),
  disabled: z.boolean().optional(),
  autoApprove: z.array(z.string()).optional(),
};

// Standard MCP server configuration (stdio type)
export const StdioServerConfigSchema = z.object({
  command: z.string().trim().min(1),
  type: z.literal('stdio').optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  ...CommonServerFields,
}).passthrough();

// Standard MCP server configuration (sse/http type)
export const HttpServerConfigSchema = z.object({
  url: z.string().url().refine(value => /^https?:\/\//i.test(value), 'URL must use HTTP or HTTPS'),
  type: z.enum(['sse', 'streamableHttp', 'http']).optional(),
  headers: z.record(z.string()).optional(),
  auth: z.object({
    type: z.literal('client_credentials'),
    clientId: z.string().min(1),
    clientSecretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    issuer: z.string().url(),
    scope: z.string().optional(),
  }).optional(),
  ...CommonServerFields,
}).passthrough();

// Union of all server config types
export const ServerConfigSchema = z.union([
  StdioServerConfigSchema,
  HttpServerConfigSchema,
]).refine(config => !(('command' in config) && ('url' in config)), 'A server cannot have both command and url');

// Standard MCP config format (mcpServers)
export const ConfigSchema = z.object({
  mcpServers: z.record(z.string(), ServerConfigSchema),
  daemonTimeout: z.number().int().positive().optional(),
}).passthrough();

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// Helper to detect server type from config
export function detectServerType(config: ServerConfig): 'stdio' | 'sse' | 'http' {
  if (config.type === 'sse') return 'sse';
  if (config.type === 'http' || config.type === 'streamableHttp') return 'http';
  if (config.type === 'stdio') return 'stdio';
  if ('url' in config && typeof config.url === 'string') {
    return config.url.includes('/sse') || config.url.endsWith('/sse') ? 'sse' : 'http';
  }
  return 'stdio';
}
