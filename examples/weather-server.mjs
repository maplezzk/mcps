import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

// A local development example. It returns simulated data and needs no network or credentials.
serveStdio(() => {
  const server = new McpServer({ name: 'mcps-local-weather-example', version: '1.0.0' });
  server.registerTool('get_weather', {
    inputSchema: z.object({ city: z.string(), country: z.string() }),
    outputSchema: z.object({
      temperature: z.object({ celsius: z.number(), fahrenheit: z.number() }),
      conditions: z.enum(['sunny', 'cloudy', 'rainy', 'stormy', 'snowy']),
      humidity: z.number().min(0).max(100),
      wind: z.object({ speed_kmh: z.number(), direction: z.string() }),
    }),
  }, async () => ({
    content: [],
    structuredContent: {
      temperature: { celsius: 24, fahrenheit: 75.2 },
      conditions: 'sunny', humidity: 50, wind: { speed_kmh: 10, direction: 'N' },
    },
  }));
  return server;
});
