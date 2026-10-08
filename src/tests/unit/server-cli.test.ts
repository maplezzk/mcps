import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

vi.mock('../../core/config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../core/config.js')>();
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return { ...actual, configManager: new actual.ConfigManager(fs.mkdtempSync(path.join(os.tmpdir(), 'mcps-cli-config-'))) };
});
import { configManager } from '../../core/config.js';
import { registerServerCommands } from '../../commands/server.js';
import { detectServerType } from '../../types/config.js';

describe('real CLI configuration handlers', () => {
  const file = configManager.getConfigPath();
  const directory = path.dirname(file);
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = 0;
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { process.exitCode = previousExitCode; vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  const run = async (args: string[]) => {
    const program = new Command().exitOverride();
    registerServerCommands(program);
    await program.parseAsync(['node', 'mcps', ...args]);
  };
  it('adds, renames, updates and removes using parsed CLI arguments', async () => {
    await run(['add', 'server', '--command', 'node', '--args', 'server.js', '--env', 'EMPTY=', 'WITH_EQUALS=a=b', '--cwd', '/tmp']);
    expect(configManager.getServer('server')).toMatchObject({ args: ['server.js'], env: { EMPTY: '', WITH_EQUALS: 'a=b' }, cwd: '/tmp' });
    await run(['rename', 'server', 'renamed']);
    await run(['update', 'renamed', '--env', 'NEW=value', '--disabled']);
    expect(configManager.getServer('renamed')).toMatchObject({ disabled: true, env: { EMPTY: '', NEW: 'value' } });
    await run(['update', 'renamed', '--enabled']);
    expect(configManager.getServer('renamed')?.disabled).toBe(false);
    await run(['ls']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('renamed'));
    await run(['rm', 'renamed']);
    expect(configManager.listServers()).toEqual([]);
  });
  it.each(['sse', 'http', 'streamableHttp'])('preserves explicit remote transport %s instead of guessing from URL', async type => {
    await run(['add', 'remote', '--type', type, '--url', 'https://example.org/events', '--header', 'X-Token=${TOKEN}', '--protocol-version', 'legacy']);
    expect(configManager.getServer('remote')).toMatchObject({ type, headers: { 'X-Token': '${TOKEN}' }, protocolVersion: 'legacy' });
    expect(detectServerType(configManager.getServer('remote')!)).toBe(type === 'sse' ? 'sse' : 'http');
  });
  it.each([
    ['add', 'bad', '--type', 'http', '--url', 'broken'],
    ['add', 'bad', '--type', 'unknown', '--command', 'node'],
    ['add', 'bad', '--command', 'node', '--env', 'BAD'],
    ['add', 'bad'],
    ['rm', 'missing'],
    ['rename', 'missing', 'other'],
    ['update', 'missing', '--command', 'node'],
  ])('returns a failure exit code for %j', async (...args) => {
    await run(args);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalled();
    expect(configManager.listServers()).toEqual([]);
  });
  it('does not overwrite broken JSON through the actual add command', async () => {
    fs.writeFileSync(file, '{broken fixture');
    await run(['add', 'new', '--command', 'node']);
    expect(process.exitCode).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken fixture');
  });
  it('reports the actual config path and rejects invalid configurations', async () => {
    await run(['config', 'path']);
    expect(console.log).toHaveBeenCalledWith(file);
    fs.writeFileSync(file, JSON.stringify({ servers: [] }));
    await run(['config', 'validate']);
    expect(process.exitCode).toBe(1);
  });
  it('keeps legacy command aliases working', async () => {
    await run(['server', 'add', 'legacy', '--command', 'node']);
    await run(['server', 'update', 'legacy', '--args', 'hello.js']);
    await run(['server', 'rename', 'legacy', 'renamed']);
    await run(['server', 'list']);
    expect(configManager.getServer('renamed')?.args).toEqual(['hello.js']);
    await run(['server', 'remove', 'renamed']);
    expect(configManager.listServers()).toEqual([]);
  });
  it('saves OAuth metadata with only the secret variable name and pins the issuer', async () => {
    await run(['add', 'oauth', '--type', 'http', '--url', 'https://example.org/mcp', '--oauth-client-id', 'client', '--oauth-client-secret-env', 'MCP_CLIENT_SECRET', '--oauth-issuer', 'https://auth.example.org', '--oauth-scope', 'mcp:read']);
    expect(configManager.getServer('oauth')?.auth).toEqual({ type: 'client_credentials', clientId: 'client', clientSecretEnv: 'MCP_CLIENT_SECRET', issuer: 'https://auth.example.org', scope: 'mcp:read' });
    await run(['update', 'oauth', '--oauth-client-id', 'new-client', '--oauth-client-secret-env', 'OTHER_SECRET', '--oauth-issuer', 'https://auth.example.org']);
    expect(configManager.getServer('oauth')?.auth).toMatchObject({ clientId: 'new-client', clientSecretEnv: 'OTHER_SECRET' });
  });
  it('rejects incomplete OAuth and options that would otherwise be silently ignored', async () => {
    await run(['add', 'bad', '--type', 'http', '--url', 'https://example.org/mcp', '--oauth-client-id', 'client']);
    expect(process.exitCode).toBe(1);
    await run(['add', 'bad', '--command', 'node', '--header', 'X-Token=value']);
    expect(configManager.listServers()).toEqual([]);
  });
});
