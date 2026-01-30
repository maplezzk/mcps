import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config, ConfigSchema, ServerConfig, ServerConfigSchema } from '../types/config.js';

const CONFIG_DIR = process.env.MCP_CONFIG_DIR || path.join(os.homedir(), '.mcpp');
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
      
      if (!json || typeof json !== 'object' || !Array.isArray(json.servers)) {
          // If the root structure is invalid, we can't do much.
          console.warn('Invalid config file structure. Expected { servers: [] }.');
          return { servers: [] };
      }

      const validServers: ServerConfig[] = [];
      const servers = json.servers;

      for (const server of servers) {
          const result = ServerConfigSchema.safeParse(server);
          if (result.success) {
              validServers.push(result.data);
          } else {
              console.warn(`Skipping invalid server config "${server?.name || 'unknown'}":`, result.error.errors[0]?.message);
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
