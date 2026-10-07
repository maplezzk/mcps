import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const state = vi.hoisted(() => ({ instances: [] as any[], connect: vi.fn() }));
vi.mock('../../core/client.js', () => ({
  McpClientService: class {
    connect = state.connect;
    close = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({ tools: [{ name: 'one' }] });
    getInfo = vi.fn().mockReturnValue({ protocolVersion: '2026-07-28' });
    constructor() { state.instances.push(this); }
  },
}));
vi.mock('../../core/config.js', () => ({ configManager: { getServer: vi.fn(), listServers: vi.fn() } }));
import { configManager } from '../../core/config.js';
import { ConnectionPool } from '../../core/pool.js';

describe('connection ownership, failures and races', () => {
  let pool: ConnectionPool;
  beforeEach(() => {
    pool = new ConnectionPool();
    state.instances.length = 0;
    state.connect.mockReset().mockResolvedValue(undefined);
    vi.mocked(configManager.getServer).mockReturnValue({ name: 'server', command: 'node' });
    vi.mocked(configManager.listServers).mockReturnValue([{ name: 'server', command: 'node' }]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(async () => { await pool.closeAll(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('deduplicates concurrent requests and clears the connection timeout', async () => {
    await Promise.all([pool.getClient('server', { timeoutMs: 1000 }), pool.getClient('server', { timeoutMs: 1000 })]);
    expect(state.instances).toHaveLength(1);
    expect(state.connect).toHaveBeenCalledTimes(1);
    expect(await pool.getActiveConnectionDetails()).toEqual([expect.objectContaining({ name: 'server', toolsCount: 1, protocolVersion: '2026-07-28' })]);
  });
  it('closes a timed-out connection and reports its failure', async () => {
    state.connect.mockImplementation(() => new Promise(() => {}));
    await expect(pool.getClient('server', { timeoutMs: 10 })).rejects.toThrow('Connection timeout');
    expect(state.instances[0].close).toHaveBeenCalled();
    expect(await pool.getActiveConnectionDetails()).toEqual([expect.objectContaining({ name: 'server', status: 'error' })]);
  });
  it('cannot resurrect a connection after a pool reset', async () => {
    let finish!: () => void;
    state.connect.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = pool.getClient('server');
    await pool.closeAll();
    finish();
    await expect(pending).rejects.toThrow('reset');
    expect(await pool.getActiveConnectionDetails()).toEqual([]);
  });
  it('blocks disabled and missing servers before spawning anything', async () => {
    vi.mocked(configManager.getServer).mockReturnValue({ name: 'server', command: 'node', disabled: true });
    await expect(pool.getClient('server')).rejects.toThrow('disabled');
    vi.mocked(configManager.getServer).mockReturnValue(undefined);
    await expect(pool.getClient('missing')).rejects.toThrow('not found');
    expect(state.instances).toEqual([]);
  });
  it('initializes only enabled servers and exposes diagnostic failures', async () => {
    vi.mocked(configManager.listServers).mockReturnValue([{ name: 'server', command: 'node' }, { name: 'disabled', command: 'node', disabled: true }]);
    state.connect.mockRejectedValue(new Error('connection unavailable'));
    await pool.initializeAll();
    expect(state.connect).toHaveBeenCalledTimes(1);
    expect(pool.getInitStatus()).toEqual({ initializing: false, initialized: true });
    expect(await pool.getActiveConnectionDetails()).toEqual([expect.objectContaining({ name: 'server', error: 'connection unavailable' })]);
  });
  it('closes and recreates a selected client without reusing stale state', async () => {
    const original = await pool.getClient('server');
    expect(await pool.closeClient('server')).toBe(true);
    const next = await pool.getClient('server');
    expect(next).not.toBe(original);
    expect(await pool.closeClient('missing')).toBe(false);
  });
});
