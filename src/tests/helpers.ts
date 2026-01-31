import fs from 'fs';
import path from 'path';
import os from 'os';
import { vi } from 'vitest';

export const TEST_CONFIG_DIR = path.join(os.tmpdir(), `mcps-test-${Date.now()}`);

export function setupTestConfig() {
  // 确保测试配置目录存在
  if (!fs.existsSync(TEST_CONFIG_DIR)) {
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  }

  // 设置测试环境变量
  process.env.MCPS_CONFIG_DIR = TEST_CONFIG_DIR;

  return TEST_CONFIG_DIR;
}

export function cleanupTestConfig() {
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  }
}

export function getTestConfigPath() {
  return path.join(TEST_CONFIG_DIR, 'mcp.json');
}

export function createTestServer(overrides: Partial<any> = {}) {
  return {
    name: 'test-server',
    type: 'stdio',
    command: 'node',
    args: ['--version'],
    ...overrides
  };
}

export function createMockClient(toolsCount: number = 5) {
  const tools = [];
  for (let i = 0; i < toolsCount; i++) {
    tools.push({
      name: `test_tool_${i}`,
      description: `Test tool ${i}`,
      inputSchema: {
        type: 'object',
        properties: {
          param: { type: 'string', description: `Parameter ${i}` }
        }
      }
    });
  }

  return {
    listTools: vi.fn().mockResolvedValue({ tools }),
    callTool: vi.fn().mockResolvedValue({ result: 'success' }),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
}
