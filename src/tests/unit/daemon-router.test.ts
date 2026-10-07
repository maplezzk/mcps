import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Command } from 'commander';
const mocks = vi.hoisted(() => ({
  client: { listTools: vi.fn(), callTool: vi.fn(), request: vi.fn() },
  pool: { initializeAll: vi.fn(), getInitStatus: vi.fn(), getActiveConnectionDetails: vi.fn(), getClient: vi.fn(), closeClient: vi.fn(), closeAll: vi.fn() },
}));
vi.mock('../../core/pool.js', () => ({ connectionPool: mocks.pool }));
vi.mock('../../core/config.js', () => ({ configManager: { getConfigPath: () => '/test-fixture/mcp.json', validateConfig: vi.fn(), getDaemonTimeout: () => 1000 } }));
import { startDaemon, registerDaemonCommand } from '../../commands/daemon.js';
import { daemonRequest } from '../../core/daemon-client.js';

describe('daemon HTTP routing and command errors', () => {
  let server: Server;
  let port: number;
  let previousExitCode: typeof process.exitCode;
  beforeEach(async () => {
    previousExitCode = process.exitCode; process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
    mocks.pool.initializeAll.mockResolvedValue(undefined);
    mocks.pool.getInitStatus.mockReturnValue({ initializing: false, initialized: true });
    mocks.pool.getActiveConnectionDetails.mockResolvedValue([{ name: 'server', status: 'connected', toolsCount: 1, protocolVersion: '2026-07-28' }]);
    mocks.pool.getClient.mockResolvedValue(mocks.client);
    mocks.pool.closeClient.mockResolvedValue(true);
    mocks.pool.closeAll.mockResolvedValue(undefined);
    mocks.client.listTools.mockResolvedValue({ tools: [{ name: 'echo' }] });
    mocks.client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] });
    mocks.client.request.mockResolvedValue({ resources: [] });
    server = startDaemon(0);
    await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    process.exitCode = previousExitCode;
    vi.restoreAllMocks(); vi.clearAllMocks();
  });
  const post = (endpoint: string, body: unknown) => daemonRequest('POST', endpoint, body, port, 1000);
  const command = async (...args: string[]) => {
    const program = new Command().exitOverride();
    registerDaemonCommand(program);
    await program.parseAsync(['node', 'mcps', ...args]);
  };
  it('returns current configuration, readiness and protocol metadata', async () => {
    const status = await daemonRequest('GET', '/status', undefined, port);
    expect(status).toMatchObject({ status: 'running', initialized: true, configPath: '/test-fixture/mcp.json' });
    expect(status.connections[0].protocolVersion).toBe('2026-07-28');
  });
  it('forwards tool arguments, timeout and opaque continuation fields', async () => {
    expect(await post('/call', { server: 'server', tool: 'echo', args: { text: 'hello' }, timeout: 10, inputResponses: {}, requestState: 'opaque' })).toEqual({ result: { content: [{ type: 'text', text: 'hello' }] } });
    expect(mocks.client.callTool).toHaveBeenCalledWith('echo', { text: 'hello' }, 10, { inputResponses: {}, requestState: 'opaque' });
  });
  it('uses fresh SDK tools rather than a separate stale pool cache', async () => {
    expect(await post('/list', { server: 'server' })).toEqual({ tools: [{ name: 'echo' }] });
    mocks.client.listTools.mockResolvedValue({ tools: [{ name: 'added' }] });
    expect(await post('/list', { server: 'server' })).toEqual({ tools: [{ name: 'added' }] });
  });
  it('forwards resource and prompt operations through the shared connection', async () => {
    expect(await post('/protocol', { server: 'server', operation: 'resources/list', params: {}, timeout: 300 })).toEqual({ result: { resources: [] } });
    expect(mocks.client.request).toHaveBeenCalledWith('resources/list', {}, 300);
  });
  it.each([{ body: null }, { body: [] }, { body: { tool: 'echo' } }, { body: { server: 'server' } }])('rejects an invalid call body: %j', async ({ body }) => {
    await expect(post('/call', body)).rejects.toThrow();
    expect(mocks.client.callTool).not.toHaveBeenCalled();
  });
  it('preserves typed protocol errors through daemon responses', async () => {
    mocks.client.callTool.mockRejectedValue(Object.assign(new Error('unsupported protocol'), { code: -32022, data: { supportedVersions: ['2026-07-28'] } }));
    await expect(post('/call', { server: 'server', tool: 'echo' })).rejects.toMatchObject({ message: 'unsupported protocol', code: -32022, data: { supportedVersions: ['2026-07-28'] } });
  });
  it('restarts an individual client or the entire pool', async () => {
    await post('/restart', { server: 'server' });
    expect(mocks.pool.closeClient).toHaveBeenCalledWith('server');
    await post('/restart', {});
    expect(mocks.pool.closeAll).toHaveBeenCalled();
    expect(mocks.pool.initializeAll).toHaveBeenCalledTimes(2);
  });
  it('returns JSON from the actual status command and recognizes an already running daemon', async () => {
    await command('status', '--port', String(port), '--json');
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0]).status).toBe('running');
    await command('start', '--port', String(port));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('already running'));
  });
  it('exercises legacy aliases and returns failure for an invalid port', async () => {
    await command('daemon', 'status', '--port', String(port));
    expect(console.table).toHaveBeenCalled();
    await command('start', '--port', 'invalid');
    expect(process.exitCode).toBe(1);
  });
  it('reports unknown routes as errors', async () => {
    await expect(daemonRequest('GET', '/missing', undefined, port)).rejects.toThrow('Unknown daemon endpoint');
    await expect(post('/missing', {})).rejects.toThrow('Unknown daemon endpoint');
  });
});
