import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Config, ConfigSchema, ServerConfig, ServerConfigSchema } from '../types/config.js';

const getDefaultConfigDir = () => process.env.MCPS_CONFIG_DIR || path.join(os.homedir(), '.mcps');
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir || getDefaultConfigDir();
    this.configFile = path.join(this.configDir, 'mcp.json');
  }

  getConfigPath() { return this.configFile; }

  private ensureConfigDir() {
    fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
  }

  private loadConfig(forWrite = false): Config {
    if (!fs.existsSync(this.configFile)) return { mcpServers: {} };
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code ?? 'Invalid JSON';
      throw new Error(`Cannot read configuration ${this.configFile}: ${reason}. Original file was not changed.`);
    }
    if (!isObject(json) || !isObject(json.mcpServers)) {
      const message = 'Invalid config format. Expected { mcpServers: { ... } }';
      if (forWrite) throw new Error(`${message}. Original file was not changed.`);
      console.warn(message);
      return { mcpServers: {} };
    }
    const validServers: Record<string, ServerConfig> = Object.create(null);
    for (const [name, server] of Object.entries(json.mcpServers)) {
      const result = ServerConfigSchema.safeParse(server);
      if (!result.success) {
        const message = `Invalid server config "${name}": ${result.error.issues[0]?.message}`;
        if (forWrite) throw new Error(`${message}. Original file was not changed.`);
        console.warn(`Skipping ${message}`);
      } else {
        validServers[name] = result.data;
      }
    }
    return ConfigSchema.parse({ ...json, mcpServers: validServers });
  }

  validateConfig() {
    this.loadConfig(true);
    return this.configFile;
  }

  private mutate(change: (config: Config) => void) {
    this.ensureConfigDir();
    const lockPath = `${this.configFile}.lock`;
    let lock: number;
    try {
      lock = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Configuration is being updated (${lockPath}). Retry after the other writer finishes.`);
      }
      throw error;
    }
    const temporary = `${this.configFile}.${randomUUID()}.tmp`;
    try {
      const config = this.loadConfig(true);
      change(config);
      const validated = ConfigSchema.parse(config);
      const mode = fs.existsSync(this.configFile) ? fs.statSync(this.configFile).mode & 0o777 : 0o600;
      fs.writeFileSync(temporary, JSON.stringify(validated, null, 2) + '\n', { mode, flag: 'wx' });
      fs.renameSync(temporary, this.configFile);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }

  listServers(): Array<ServerConfig & { name: string }> {
    return Object.entries(this.loadConfig().mcpServers).map(([name, server]) => ({ ...server, name }));
  }

  getServer(name: string): (ServerConfig & { name: string }) | undefined {
    const servers = this.loadConfig().mcpServers;
    return Object.hasOwn(servers, name) ? { ...servers[name], name } : undefined;
  }

  addServer(name: string, server: ServerConfig) {
    const validated = ServerConfigSchema.parse(server);
    this.mutate(config => {
      if (Object.hasOwn(config.mcpServers, name)) throw new Error(`Server with name "${name}" already exists.`);
      Object.defineProperty(config.mcpServers, name, { value: validated, enumerable: true, writable: true, configurable: true });
    });
  }

  removeServer(name: string) {
    this.mutate(config => {
      if (!Object.hasOwn(config.mcpServers, name)) throw new Error(`Server with name "${name}" not found.`);
      delete config.mcpServers[name];
    });
  }

  renameServer(oldName: string, newName: string) {
    this.mutate(config => {
      if (!Object.hasOwn(config.mcpServers, oldName)) throw new Error(`Server with name "${oldName}" not found.`);
      if (Object.hasOwn(config.mcpServers, newName)) throw new Error(`Server with name "${newName}" already exists.`);
      config.mcpServers = Object.fromEntries(Object.entries(config.mcpServers).map(([key, value]) => [key === oldName ? newName : key, value]));
    });
  }

  updateServer(name: string, updates: Partial<ServerConfig>) {
    this.mutate(config => {
      if (!Object.hasOwn(config.mcpServers, name)) throw new Error(`Server with name "${name}" not found.`);
      const updated: Record<string, unknown> = { ...config.mcpServers[name], ...updates };
      if ('url' in updates) {
        delete updated.command; delete updated.args; delete updated.env; delete updated.cwd;
        if (!('type' in updates)) delete updated.type;
      } else if ('command' in updates) {
        delete updated.url; delete updated.headers; delete updated.auth;
        if (!('type' in updates)) updated.type = 'stdio';
      }
      const result = ServerConfigSchema.safeParse(updated);
      if (!result.success) throw new Error(`Invalid update: ${result.error.message}`);
      config.mcpServers[name] = result.data;
    });
  }

  getDaemonTimeout(): number {
    const env = process.env.MCPS_DAEMON_TIMEOUT;
    if (env && /^\d+$/.test(env) && Number(env) > 0) return Number(env) * 1000;
    return this.loadConfig().daemonTimeout ?? 20000;
  }
}

export const configManager = new ConfigManager();
