import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../../core/config.js';

describe('ConfigManager', () => {
  let testConfigDir: string;
  let manager: ConfigManager;

  beforeEach(() => {
    // 创建临时配置目录
    testConfigDir = path.join(os.tmpdir(), `mcps-config-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testConfigDir, { recursive: true });

    // 创建新的 ConfigManager 实例，传入测试目录
    manager = new ConfigManager(testConfigDir);
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(testConfigDir)) {
      try {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      } catch (e) {
        // 忽略清理错误
      }
    }
  });

  describe('addServer', () => {
    it('should add a stdio server', () => {
      const server = {
        name: 'test-stdio',
        type: 'stdio' as const,
        command: 'node',
        args: ['--version']
      };

      manager.addServer(server);
      const servers = manager.listServers();

      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject(server);
    });

    it('should add an sse server', () => {
      const server = {
        name: 'test-sse',
        type: 'sse' as const,
        url: 'http://localhost:3000/sse'
      };

      manager.addServer(server);
      const retrieved = manager.getServer('test-sse');

      expect(retrieved).toMatchObject(server);
    });

    it('should add an http server', () => {
      const server = {
        name: 'test-http',
        type: 'http' as const,
        url: 'http://localhost:3000/mcp'
      };

      manager.addServer(server);
      const retrieved = manager.getServer('test-http');

      expect(retrieved).toMatchObject(server);
    });

    it('should add server with disabled flag', () => {
      const server = {
        name: 'disabled-server',
        type: 'stdio' as const,
        command: 'node',
        args: [],
        disabled: true
      };

      manager.addServer(server);
      const retrieved = manager.getServer('disabled-server');

      expect(retrieved).toMatchObject({
        name: 'disabled-server',
        disabled: true
      });
    });

    it('should throw error when adding duplicate server', () => {
      const server = {
        name: 'duplicate',
        type: 'stdio' as const,
        command: 'node',
        args: []
      };

      manager.addServer(server);

      expect(() => manager.addServer(server)).toThrow('already exists');
    });
  });

  describe('getServer', () => {
    it('should retrieve existing server', () => {
      const server = {
        name: 'to-retrieve',
        type: 'stdio' as const,
        command: 'node',
        args: []
      };

      manager.addServer(server);
      const retrieved = manager.getServer('to-retrieve');

      expect(retrieved).toMatchObject(server);
    });

    it('should return undefined for non-existing server', () => {
      const retrieved = manager.getServer('non-existing');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('listServers', () => {
    it('should return empty array when no servers', () => {
      const servers = manager.listServers();

      expect(servers).toEqual([]);
    });

    it('should return all servers including disabled ones', () => {
      const server1 = {
        name: 'server-1',
        type: 'stdio' as const,
        command: 'node',
        args: []
      };
      const server2 = {
        name: 'server-2',
        type: 'stdio' as const,
        command: 'npm',
        args: ['start'],
        disabled: true
      };

      manager.addServer(server1);
      manager.addServer(server2);
      const servers = manager.listServers();

      expect(servers).toHaveLength(2);
    });
  });

  describe('removeServer', () => {
    it('should remove existing server', () => {
      const server = {
        name: 'to-remove',
        type: 'stdio' as const,
        command: 'node',
        args: []
      };

      manager.addServer(server);
      expect(manager.listServers()).toHaveLength(1);

      manager.removeServer('to-remove');
      expect(manager.listServers()).toHaveLength(0);
    });

    it('should throw error when removing non-existing server', () => {
      expect(() => manager.removeServer('non-existing')).toThrow('not found');
    });
  });

  describe('updateServer', () => {
    it('should update server configuration', () => {
      const original = {
        name: 'to-update',
        type: 'stdio' as const,
        command: 'node',
        args: ['--version']
      };

      manager.addServer(original);

      const updates = {
        command: 'npm',
        args: ['start']
      };

      manager.updateServer('to-update', updates);
      const updated = manager.getServer('to-update');

      expect(updated).toMatchObject({
        name: 'to-update',
        command: 'npm',
        args: ['start']
      });
    });

    it('should preserve disabled status during update', () => {
      const original = {
        name: 'update-disabled',
        type: 'stdio' as const,
        command: 'node',
        args: [],
        disabled: true
      };

      manager.addServer(original);
      manager.updateServer('update-disabled', { command: 'npm' });
      const updated = manager.getServer('update-disabled');

      expect(updated?.disabled).toBe(true);
      expect(updated?.command).toBe('npm');
    });

    it('should throw error when updating non-existing server', () => {
      expect(() => manager.updateServer('non-existing', {})).toThrow('not found');
    });
  });

  describe('persistence', () => {
    it('should persist configuration to file', () => {
      const server = {
        name: 'persistent',
        type: 'stdio' as const,
        command: 'node',
        args: []
      };

      manager.addServer(server);

      const configFile = path.join(testConfigDir, 'mcp.json');
      expect(fs.existsSync(configFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      expect(content.servers).toHaveLength(1);
      expect(content.servers[0].name).toBe('persistent');
    });

    it('should load existing configuration on instantiation', () => {
      const configFile = path.join(testConfigDir, 'mcp.json');
      const existingConfig = {
        servers: [
          {
            name: 'existing',
            type: 'stdio',
            command: 'node',
            args: []
          }
        ]
      };

      fs.writeFileSync(configFile, JSON.stringify(existingConfig, null, 2));

      const newManager = new ConfigManager(testConfigDir);
      const servers = newManager.listServers();

      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('existing');
    });
  });
});
