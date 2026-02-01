import { z } from 'zod';

// Standard MCP server configuration (stdio type)
export const StdioServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  disabled: z.boolean().optional(),
  autoApprove: z.array(z.string()).optional(),
}).passthrough();

// Standard MCP server configuration (sse/http type)
export const HttpServerConfigSchema = z.object({
  url: z.string().url(),
  disabled: z.boolean().optional(),
  autoApprove: z.array(z.string()).optional(),
}).passthrough();

// Union of all server config types
export const ServerConfigSchema = z.union([
  StdioServerConfigSchema,
  HttpServerConfigSchema,
]);

// Standard MCP config format (mcpServers)
export const ConfigSchema = z.object({
  mcpServers: z.record(z.string(), ServerConfigSchema),
  daemonTimeout: z.number().optional(),
});

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// Helper to detect server type from config
export function detectServerType(config: ServerConfig): 'stdio' | 'sse' | 'http' {
  if ('url' in config && typeof config.url === 'string') {
    return config.url.includes('/sse') || config.url.endsWith('/sse') ? 'sse' : 'http';
  }
  return 'stdio';
}
