import { z } from 'zod';

export const ServerConfigSchema = z.union([
  z.object({
    name: z.string(),
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
  }).passthrough(),
  z.object({
    name: z.string(),
    type: z.literal('sse'),
    url: z.string().url(),
  }).passthrough(),
  z.object({
    name: z.string(),
    type: z.literal('http'),
    url: z.string().url(),
  }).passthrough(),
]);

export const ConfigSchema = z.object({
  servers: z.array(ServerConfigSchema).default([]),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
