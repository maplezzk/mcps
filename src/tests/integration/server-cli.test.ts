import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('server update CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mcps-update-'));
  const config = join(directory, 'mcp.json');
  const original = { mcpServers: { fixture: { command: 'node', args: ['old'] } } };
  const run = (...args: string[]) => spawnSync(process.execPath,
    [resolve('dist/index.js'), 'update', 'fixture', ...args],
    { env: { ...process.env, MCPS_CONFIG_DIR: directory }, encoding: 'utf8', timeout: 5000 });
  const saved = () => JSON.parse(readFileSync(config, 'utf8')).mcpServers.fixture;

  beforeAll(() => writeFileSync(config, JSON.stringify(original)));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('keeps omitted arguments, clears bare --args, and preserves an explicit empty argument', () => {
    expect(run('--command', 'node').status).toBe(0);
    expect(saved().args).toEqual(['old']);
    expect(run('--args').status).toBe(0);
    expect(saved().args).toEqual([]);
    expect(run('--args', '').status).toBe(0);
    expect(saved().args).toEqual(['']);
    expect(run('--args', 'new').status).toBe(0);
    expect(saved().args).toEqual(['new']);
  });

  it('returns nonzero for an invalid update and preserves the previous configuration', () => {
    writeFileSync(config, JSON.stringify(original));
    const before = readFileSync(config, 'utf8');
    const result = run('--url', 'not-a-url');
    expect(result.error).toBeUndefined();
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error updating server');
    expect(readFileSync(config, 'utf8')).toBe(before);
  });
});
