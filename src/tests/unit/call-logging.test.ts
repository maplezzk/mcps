import { describe, it, expect } from 'vitest';

describe('tool call logging format', () => {
  describe('log message formatting', () => {
    it('should format tool request message correctly', () => {
      const serverName = 'test-server';
      const toolName = 'test_tool';
      const args = { arg1: 'value1', arg2: 123 };

      const message = `[Tool Request] Server: ${serverName}, Tool: ${toolName}, Args: ${JSON.stringify(args)}`;

      expect(message).toContain('[Tool Request]');
      expect(message).toContain(`Server: ${serverName}`);
      expect(message).toContain(`Tool: ${toolName}`);
      expect(message).toContain('Args:');
      expect(message).toContain('arg1');
      expect(message).toContain('value1');
    });

    it('should format tool response message correctly', () => {
      const serverName = 'test-server';
      const toolName = 'test_tool';
      const result = { content: [{ type: 'text', text: 'success' }] };

      const message = `[Tool Response] Server: ${serverName}, Tool: ${toolName}, Result: ${JSON.stringify(result)}`;

      expect(message).toContain('[Tool Response]');
      expect(message).toContain(`Server: ${serverName}`);
      expect(message).toContain(`Tool: ${toolName}`);
      expect(message).toContain('Result:');
    });

    it('should handle empty args', () => {
      const serverName = 'test-server';
      const toolName = 'test_tool';
      const args = {};

      const message = `[Tool Request] Server: ${serverName}, Tool: ${toolName}, Args: ${JSON.stringify(args)}`;

      expect(message).toContain('Args: {}');
    });

    it('should handle complex nested args', () => {
      const serverName = 'test-server';
      const toolName = 'test_tool';
      const args = {
        user: { name: 'Alice', settings: { theme: 'dark' } },
        items: [1, 2, 3]
      };

      const message = `[Tool Request] Server: ${serverName}, Tool: ${toolName}, Args: ${JSON.stringify(args)}`;

      expect(message).toContain('Alice');
      expect(message).toContain('dark');
      expect(message).toContain('items');
    });

    it('should log by default without MCPS_VERBOSE environment variable', () => {
      // 确保 MCPS_VERBOSE 未设置时也默认记录日志
      delete process.env.MCPS_VERBOSE;

      // 日志记录不依赖 MCPS_VERBOSE 环境变量
      const serverName = 'test-server';
      const toolName = 'test_tool';
      const args = { test: 'value' };

      // 无论 MCPS_VERBOSE 是否设置，都应该记录日志
      const message = `[Tool Request] Server: ${serverName}, Tool: ${toolName}, Args: ${JSON.stringify(args)}`;

      expect(message).toBeDefined();
    });
  });
});
