import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config, ConfigSchema, ServerConfig, ServerConfigSchema } from '../types/config.js';

const getDefaultConfigDir = () => process.env.MCPS_CONFIG_DIR || path.join(os.homedir(), '.mcps');

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir || getDefaultConfigDir();
    this.configFile = path.join(this.configDir, 'mcp.json');
  }

  private ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private loadConfig(): Config {
    this.ensureConfigDir();
    if (!fs.existsSync(this.configFile)) {
      return { mcpServers: {} };
    }
    try {
      const content = fs.readFileSync(this.configFile, 'utf-8');
      const json = JSON.parse(content);

      if (!json || typeof json !== 'object') {
        console.warn('Invalid config file structure. Expected JSON object.');
        return { mcpServers: {} };
      }

      // Only accept standard MCP format: { mcpServers: { ... } }
      if (!json.mcpServers || typeof json.mcpServers !== 'object') {
        console.warn('Invalid config format. Expected { mcpServers: { ... } }');
        return { mcpServers: {} };
      }

      // Validate each server config
      const validServers: Record<string, ServerConfig> = {};
      for (const [name, serverConfig] of Object.entries(json.mcpServers)) {
        const result = ServerConfigSchema.safeParse(serverConfig);
        if (result.success) {
          validServers[name] = result.data;
        } else {
          console.warn(`Skipping invalid server config "${name}":`, result.error.errors[0]?.message);
        }
      }

      return { mcpServers: validServers };
    } catch (error) {
      console.error('Failed to parse config file:', error);
      return { mcpServers: {} };
    }
  }

  private saveConfig(config: Config) {
    this.ensureConfigDir();
    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  listServers(): Array<ServerConfig & { name: string }> {
    const config = this.loadConfig();
    return Object.entries(config.mcpServers).map(([name, server]) => ({
      name,
      ...server,
    }));
  }

  getServer(name: string): (ServerConfig & { name: string }) | undefined {
    const config = this.loadConfig();
    const server = config.mcpServers[name];
    if (!server) return undefined;
    return { name, ...server };
  }

  addServer(name: string, server: ServerConfig) {
    const config = this.loadConfig();
    if (config.mcpServers[name]) {
      throw new Error(`Server with name "${name}" already exists.`);
    }
    config.mcpServers[name] = server;
    this.saveConfig(config);
  }

  removeServer(name: string) {
    const config = this.loadConfig();
    if (!config.mcpServers[name]) {
      throw new Error(`Server with name "${name}" not found.`);
    }
    delete config.mcpServers[name];
    this.saveConfig(config);
  }

  updateServer(name: string, updates: Partial<ServerConfig>) {
    const config = this.loadConfig();
    const current = config.mcpServers[name];
    if (!current) {
      throw new Error(`Server with name "${name}" not found.`);
    }

    const updated = { ...current, ...updates };
    const result = ServerConfigSchema.safeParse(updated);
    if (!result.success) {
      throw new Error(`Invalid update: ${result.error.message}`);
    }

    config.mcpServers[name] = result.data;
    this.saveConfig(config);
  }

  getDaemonTimeout(): number {
    // Priority: environment variable > config file > default
    const envTimeout = process.env.MCPS_DAEMON_TIMEOUT;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed * 1000; // Convert seconds to milliseconds
      }
    }

    const config = this.loadConfig();
    if (config.daemonTimeout) {
      return config.daemonTimeout;
    }

    return 20000; // Default 20 seconds
  }
}

export const configManager = new ConfigManager();
