import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
vi.mock('../../core/config.js', () => ({ configManager: { getServer: vi.fn() } }));
vi.mock('../../core/daemon-client.js', () => ({
  DaemonClient: { ensureDaemon: vi.fn(), listTools: vi.fn() },
}));
import { configManager } from '../../core/config.js';
import { DaemonClient } from '../../core/daemon-client.js';
import { registerToolsCommand } from '../../commands/tools.js';

describe('actual tools command rendering and filtering', () => {
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    previousExitCode = process.exitCode; process.exitCode = 0;
    vi.mocked(configManager.getServer).mockReturnValue({ name: 'server', command: 'node' });
    vi.mocked(DaemonClient.listTools).mockResolvedValue([{
      name: 'nested_tool', description: 'Nested tool',
      inputSchema: { type: 'object', required: ['settings'], properties: {
        settings: { type: 'object', required: ['language'], properties: { language: { type: 'string', enum: ['en', 'zh'] } } },
        items: { type: 'array', items: { type: 'number' } },
      } },
    }, { name: 'other_tool', inputSchema: { type: 'object', properties: {} } }]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { process.exitCode = previousExitCode; vi.restoreAllMocks(); vi.clearAllMocks(); });
  const run = async (...args: string[]) => {
    const program = new Command().exitOverride();
    registerToolsCommand(program);
    await program.parseAsync(['node', 'mcps', 'tools', 'server', ...args]);
  };
  const output = () => vi.mocked(console.log).mock.calls.flat().join('\n');
  it('renders nested properties, required fields, arrays and enum values', async () => {
    await run();
    expect(output()).toContain('settings*: object');
    expect(output()).toContain('language*: string ["en", "zh"]');
    expect(output()).toContain('items: array of number');
    expect(DaemonClient.listTools).toHaveBeenCalledWith('server');
  });
  it('filters names case-insensitively and supports simple output', async () => {
    await run('--tool', 'NESTED', '--simple');
    expect(output()).toContain('nested_tool');
    expect(output()).not.toContain('other_tool');
    expect(output()).toContain('Total: 1');
  });
  it('outputs an actual JSON array', async () => {
    await run('--json');
    expect(JSON.parse(output()).map((tool: any) => tool.name)).toEqual(['nested_tool', 'other_tool']);
  });
  it('keeps empty JSON output parseable', async () => {
    vi.mocked(DaemonClient.listTools).mockResolvedValue([]);
    await run('--json');
    expect(JSON.parse(output())).toEqual([]);
  });
  it('does not start or connect disabled servers', async () => {
    vi.mocked(configManager.getServer).mockReturnValue({ name: 'server', command: 'node', disabled: true });
    await run();
    expect(process.exitCode).toBe(1);
    expect(DaemonClient.ensureDaemon).not.toHaveBeenCalled();
  });
  it('returns failure when discovery fails', async () => {
    vi.mocked(DaemonClient.listTools).mockRejectedValue(new Error('connection failed'));
    await run();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('connection failed'));
  });
});
