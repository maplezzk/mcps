import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigManager } from '../../core/config.js';

describe('configuration safety', () => {
  let directory: string;
  let file: string;
  let manager: ConfigManager;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcps-config-safety-'));
    file = path.join(directory, 'mcp.json');
    manager = new ConfigManager(directory);
    vi.stubEnv('MCPS_DAEMON_TIMEOUT', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  const write = (value: unknown) => fs.writeFileSync(file, JSON.stringify(value));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  it('reads root timeout and preserves root/extension fields across writes', () => {
    write({ mcpServers: { original: { command: 'node', custom: { enabled: true } } }, daemonTimeout: 90000, customRoot: { revision: 3 } });
    expect(manager.getDaemonTimeout()).toBe(90000);
    manager.addServer('new', { command: 'node' });
    manager.renameServer('new', 'renamed');
    manager.updateServer('renamed', { args: ['--version'] });
    manager.removeServer('renamed');
    expect(read()).toEqual({ mcpServers: { original: { command: 'node', custom: { enabled: true } } }, daemonTimeout: 90000, customRoot: { revision: 3 } });
  });
  it.each(['broken JSON', '', '{'])('refuses to overwrite unreadable JSON: %j', content => {
    fs.writeFileSync(file, content);
    expect(() => manager.addServer('new', { command: 'node' })).toThrow('Original file was not changed');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
    expect(fs.readdirSync(directory)).toEqual(['mcp.json']);
  });
  it.each([{ value: null }, { value: [] }, { value: { servers: [] } }, { value: { mcpServers: [] } }])('refuses to overwrite an unsupported root: %j', ({ value }) => {
    write(value);
    const original = fs.readFileSync(file, 'utf8');
    expect(() => manager.addServer('new', { command: 'node' })).toThrow('Original file was not changed');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('preserves invalid existing entries rather than deleting them during a write', () => {
    write({ mcpServers: { bad: { url: 'bad URL' }, good: { command: 'node' } } });
    const original = fs.readFileSync(file, 'utf8');
    expect(manager.listServers().map(server => server.name)).toEqual(['good']);
    expect(() => manager.updateServer('good', { args: [] })).toThrow('Original file was not changed');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(() => manager.validateConfig()).toThrow('bad');
  });
  it.each([{ url: 'not-a-url' }, { command: '' }, { command: 'node', url: 'https://example.org/mcp' }, { url: 'ftp://example.org/file' }])('validates additions before persisting: %j', server => {
    expect(() => manager.addServer('bad', server as any)).toThrow();
    expect(fs.existsSync(file)).toBe(false);
  });
  it('makes environment timeout override explicit and rejects malformed overrides', () => {
    write({ mcpServers: {}, daemonTimeout: 90000 });
    vi.stubEnv('MCPS_DAEMON_TIMEOUT', '12');
    expect(manager.getDaemonTimeout()).toBe(12000);
    vi.stubEnv('MCPS_DAEMON_TIMEOUT', '12bad');
    expect(manager.getDaemonTimeout()).toBe(90000);
    vi.stubEnv('MCPS_DAEMON_TIMEOUT', '-1');
    expect(manager.getDaemonTimeout()).toBe(90000);
  });
  it('leaves the original file intact when atomic replacement fails', () => {
    write({ mcpServers: { original: { command: 'node' } } });
    const original = fs.readFileSync(file, 'utf8');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('simulated disk error'); });
    expect(() => manager.addServer('new', { command: 'node' })).toThrow('simulated disk error');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(directory)).toEqual(['mcp.json']);
  });
  it('refuses an overlapping writer and preserves its lock', () => {
    fs.writeFileSync(file + '.lock', 'another writer');
    expect(() => manager.addServer('new', { command: 'node' })).toThrow('being updated');
    expect(fs.readFileSync(file + '.lock', 'utf8')).toBe('another writer');
  });
  it('switches transports without retaining conflicting old fields', () => {
    manager.addServer('server', { command: 'node', args: ['old.js'], cwd: '/tmp' });
    manager.updateServer('server', { url: 'https://example.org/events', type: 'sse' });
    expect(manager.getServer('server')).toMatchObject({ url: 'https://example.org/events', type: 'sse' });
    expect(manager.getServer('server')).not.toHaveProperty('command');
    manager.updateServer('server', { command: 'python' });
    expect(manager.getServer('server')).toMatchObject({ command: 'python', type: 'stdio' });
    expect(manager.getServer('server')).not.toHaveProperty('url');
  });
  it('does not overwrite a valid configuration on an invalid update', () => {
    manager.addServer('server', { command: 'node' });
    const original = fs.readFileSync(file, 'utf8');
    expect(() => manager.updateServer('server', { url: 'broken' })).toThrow('Invalid update');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('handles names inherited from Object.prototype as ordinary server names', () => {
    manager.addServer('constructor', { command: 'node' });
    expect(manager.getServer('constructor')?.command).toBe('node');
    expect(manager.getServer('toString')).toBeUndefined();
  });
});
