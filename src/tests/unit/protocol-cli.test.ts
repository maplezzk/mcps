import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
vi.mock('../../core/config.js', () => ({ configManager: { getServer: vi.fn() } }));
vi.mock('../../core/daemon-client.js', () => ({ DaemonClient: { ensureDaemon: vi.fn(), request: vi.fn() } }));
import { configManager } from '../../core/config.js';
import { DaemonClient } from '../../core/daemon-client.js';
import { registerProtocolCommands } from '../../commands/protocol.js';
describe('MCP protocol command parameters and failures', () => {
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    previousExitCode = process.exitCode; process.exitCode = 0;
    vi.mocked(configManager.getServer).mockReturnValue({ name: 'server', command: 'node' });
    vi.mocked(DaemonClient.request).mockResolvedValue({ resources: [] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { process.exitCode = previousExitCode; vi.restoreAllMocks(); vi.clearAllMocks(); });
  const run = async (...args: string[]) => {
    const program = new Command().exitOverride();
    registerProtocolCommands(program);
    await program.parseAsync(['node', 'mcps', ...args]);
  };
  it.each([
    ['discover', 'info'], ['resources', 'resources/list'], ['prompts', 'prompts/list'],
  ])('routes %s to %s', async (command, operation) => {
    await run(command, 'server');
    expect(DaemonClient.request).toHaveBeenCalledWith('server', operation, {});
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual({ resources: [] });
  });
  it('preserves resource request state and manual input responses', async () => {
    await run('read', 'server', 'test://document', '--request-state', 'opaque', '--input-responses', '{"approval":{"action":"decline"}}');
    expect(DaemonClient.request).toHaveBeenCalledWith('server', 'resources/read', { uri: 'test://document', requestState: 'opaque', inputResponses: { approval: { action: 'decline' } } });
  });
  it('selects templates and preserves string prompt arguments', async () => {
    await run('resources', 'server', '--templates');
    expect(DaemonClient.request).toHaveBeenCalledWith('server', 'resources/templates/list', {});
    await run('prompt', 'server', 'welcome', 'code=001', 'enabled=true');
    expect(DaemonClient.request).toHaveBeenCalledWith('server', 'prompts/get', { name: 'welcome', arguments: { code: '001', enabled: 'true' } });
  });
  it('accepts JSON prompt and completion parameters', async () => {
    await run('prompt', 'server', 'welcome', '--json', '{"name":"Taipei"}');
    expect(DaemonClient.request).toHaveBeenCalledWith('server', 'prompts/get', { name: 'welcome', arguments: { name: 'Taipei' } });
    await run('complete', 'server', '--json', '{"ref":{"type":"ref/prompt","name":"welcome"},"argument":{"name":"name","value":"T"}}');
    expect(DaemonClient.request).toHaveBeenCalledWith('server', 'completion/complete', expect.objectContaining({ argument: { name: 'name', value: 'T' } }));
  });
  it.each(['[]', '{"name":1}', '{invalid'])('rejects invalid prompt parameters: %s', async json => {
    await run('prompt', 'server', 'welcome', '--json', json);
    expect(process.exitCode).toBe(1);
    expect(DaemonClient.ensureDaemon).not.toHaveBeenCalled();
  });
  it('does not connect an unknown or disabled server', async () => {
    vi.mocked(configManager.getServer).mockReturnValue(undefined);
    await run('discover', 'missing');
    expect(process.exitCode).toBe(1);
    vi.mocked(configManager.getServer).mockReturnValue({ name: 'server', command: 'node', disabled: true });
    await run('resources', 'server');
    expect(DaemonClient.ensureDaemon).not.toHaveBeenCalled();
  });
  it('returns exit 2 for incomplete requests and exit 1 for transport failures', async () => {
    vi.mocked(DaemonClient.request).mockResolvedValue({ resultType: 'input_required', requestState: 'opaque' });
    await run('read', 'server', 'test://document');
    expect(process.exitCode).toBe(2);
    vi.mocked(DaemonClient.request).mockRejectedValue(new Error('transport failed'));
    await run('resources', 'server');
    expect(process.exitCode).toBe(1);
  });
});
