import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config, ConfigSchema, ServerConfig, ServerConfigSchema } from '../types/config.js';

const CONFIG_DIR = process.env.MCP_CONFIG_DIR || path.join(os.homedir(), '.mcps');
const CONFIG_FILE = path.join(CONFIG_DIR, 'mcp.json');

export class ConfigManager {
  private ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  private loadConfig(): Config {
    this.ensureConfigDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      return { servers: [] };
    }
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const json = JSON.parse(content);
      
      // Log for debugging (can be removed later or controlled by verbose flag)
      // console.log('Loading config from:', CONFIG_FILE);

      if (!json || typeof json !== 'object') {
          console.warn('Invalid config file structure. Expected JSON object.');
          return { servers: [] };
      }

      // Handle both { servers: [...] } and { mcpServers: { ... } } (VSCode/Claude style)
      let servers: any[] = [];
      
      if (Array.isArray(json.servers)) {
          servers = json.servers;
      } else if (json.mcpServers && typeof json.mcpServers === 'object') {
          // Convert map to array
          servers = Object.entries(json.mcpServers).map(([name, config]: [string, any]) => ({
              name,
              ...config
          }));
      }

      const validServers: ServerConfig[] = [];

      for (const server of servers) {
          const result = ServerConfigSchema.safeParse(server);
          if (result.success) {
              validServers.push(result.data);
          } else {
              // Only warn if it looks like a server config we *should* have supported
              if (server.name) {
                  console.warn(`Skipping invalid server config "${server.name}":`, result.error.errors[0]?.message);
              }
          }
      }

      return { servers: validServers };

    } catch (error) {
      console.error('Failed to parse config file:', error);
      return { servers: [] };
    }
  }

  private saveConfig(config: Config) {
    this.ensureConfigDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  }

  listServers(): ServerConfig[] {
    return this.loadConfig().servers;
  }

  getServer(name: string): ServerConfig | undefined {
    const config = this.loadConfig();
    return config.servers.find(s => s.name === name);
  }

  addServer(server: ServerConfig) {
    const config = this.loadConfig();
    if (config.servers.find(s => s.name === server.name)) {
      throw new Error(`Server with name "${server.name}" already exists.`);
    }
    config.servers.push(server);
    this.saveConfig(config);
  }

  removeServer(name: string) {
    const config = this.loadConfig();
    const initialLength = config.servers.length;
    config.servers = config.servers.filter(s => s.name !== name);
    if (config.servers.length === initialLength) {
      throw new Error(`Server with name "${name}" not found.`);
    }
    this.saveConfig(config);
  }

  updateServer(name: string, updates: Partial<ServerConfig>) {
    const config = this.loadConfig();
    const index = config.servers.findIndex(s => s.name === name);
    if (index === -1) {
      throw new Error(`Server with name "${name}" not found.`);
    }

    const current = config.servers[index];
    const updated = { ...current, ...updates };
    
    // Validate the updated object matches the schema (especially type consistency)
    const result = ServerConfigSchema.safeParse(updated);
    if (!result.success) {
        throw new Error(`Invalid update: ${result.error.message}`);
    }

    config.servers[index] = result.data;
    this.saveConfig(config);
  }
}

export const configManager = new ConfigManager();
