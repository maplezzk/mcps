import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fixture, repository, runCli, startFixture, stopFixture, freePort, waitForDaemonExit } from './helpers.js';

describe('CLI to daemon to real MCP servers', () => {
  let directory: string;
  let port: number;
  let env: Record<string, string>;
  let daemon: ChildProcess;
  let remote: Awaited<ReturnType<typeof startFixture>>;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcps-cli-integration-'));
    port = await freePort();
    remote = await startFixture('http');
    env = { MCPS_CONFIG_DIR: directory, MCPS_PORT: String(port), MCPS_DAEMON_TIMEOUT: '10' };
    fs.writeFileSync(path.join(directory, 'mcp.json'), JSON.stringify({ daemonTimeout: 10000, mcpServers: {
      stdio: { command: process.execPath, args: [fixture], cwd: directory, env: { FIXTURE_EMPTY: '' } },
      legacy: { command: process.execPath, args: [fixture, 'stdio', 'legacy'] },
      remote: { url: remote.url, type: 'http' },
    } }));
    daemon = spawn(process.execPath, ['dist/index.js', 'start'], { cwd: repository, env: { ...process.env, ...env, MCPS_DAEMON_DETACHED: 'true' }, stdio: 'ignore' });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (daemon.exitCode !== null) throw new Error('Integration daemon exited before readiness');
      const status = await fetch('http://127.0.0.1:' + port + '/status').then(response => response.json(), () => null);
      if (status?.initialized && status.connections.length === 3) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Integration daemon did not become ready');
  });
  afterAll(async () => {
    if (daemon && daemon.exitCode === null) {
      await runCli(['stop'], env);
      await waitForDaemonExit(port);
      await stopFixture(daemon);
    }
    if (remote) await stopFixture(remote.child);
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  const run = (...args: string[]) => runCli(args, env);
  it('reports negotiated modern and legacy protocols through real status/discover commands', async () => {
    const status = await run('status', '--json');
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout).connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'stdio', protocolVersion: '2026-07-28' }),
      expect.objectContaining({ name: 'legacy', protocolVersion: '2025-11-25' }),
    ]));
    const discover = await run('discover', 'remote');
    expect(JSON.parse(discover.stdout)).toMatchObject({ protocolEra: 'modern', protocolVersion: '2026-07-28' });
  });
  it('honors --port even when MCPS_PORT names another port', async () => {
    const result = await runCli(['status', '--port', String(port), '--json'], { ...env, MCPS_PORT: '1' });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('running');
  });
  it('executes actual CLI calls with parseable full JSON results', async () => {
    const result = await run('call', 'stdio', 'echo', 'text=hello', '--output-json');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).structuredContent).toMatchObject({ text: 'hello', cwd: directory, empty: '' });
    const rich = await run('call', 'remote', 'rich', '--output-json');
    expect(rich.code).toBe(0);
    expect(JSON.parse(rich.stdout).structuredContent).toEqual([1, 2, 3]);
    expect(JSON.parse(rich.stdout).content.some((block: any) => block.type === 'audio')).toBe(true);
  });
  it('returns a failing process status for tool-level failures', async () => {
    const result = await run('call', 'stdio', 'fail', '--output-json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ isError: true });
    expect(result.stdout).not.toContain('successful');
  });
  it('returns exit 2 for required input and supports an explicit continuation', async () => {
    const first = await run('call', 'stdio', 'confirm', '--output-json');
    expect(first.code).toBe(2);
    const required = JSON.parse(first.stdout);
    expect(required.resultType).toBe('input_required');
    const result = await run('call', 'stdio', 'confirm', '--output-json', '--request-state', required.requestState, '--input-responses', JSON.stringify({ approval: { action: 'accept', content: { approved: true } } }));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).content[0].text).toBe('approved');
  });
  it('exposes resources, resource templates, prompts and completion from the CLI', async () => {
    expect(JSON.parse((await run('resources', 'remote')).stdout).resources[0].uri).toBe('fixture://document');
    expect(JSON.parse((await run('resources', 'remote', '--templates')).stdout).resourceTemplates[0].uriTemplate).toBe('fixture://items/{name}');
    expect(JSON.parse((await run('read', 'remote', 'fixture://document')).stdout).contents[0].text).toBe('fixture document');
    expect(JSON.parse((await run('prompts', 'remote')).stdout).prompts[0].name).toBe('welcome');
    expect(JSON.parse((await run('prompt', 'remote', 'welcome', 'name=Taipei')).stdout).messages[0].content.text).toBe('Hello Taipei');
    const completion = await run('complete', 'remote', '--json', JSON.stringify({ ref: { type: 'ref/prompt', name: 'welcome' }, argument: { name: 'name', value: 'T' } }));
    expect(JSON.parse(completion.stdout).completion.values).toEqual(['Taipei', 'Tokyo']);
  });
  it('restarts a stdio connection and reaps its previous child', async () => {
    const before = JSON.parse((await run('call', 'stdio', 'echo', 'text=before', '--output-json')).stdout).structuredContent.pid;
    expect((await run('restart', 'stdio')).code).toBe(0);
    const after = JSON.parse((await run('call', 'stdio', 'echo', 'text=after', '--output-json')).stdout).structuredContent.pid;
    expect(after).not.toBe(before);
    expect(() => process.kill(before, 0)).toThrow();
  });
  it('blocks disabled servers in both the CLI and direct daemon requests', async () => {
    try {
      expect((await run('update', 'stdio', '--disabled')).code).toBe(0);
      expect((await run('tools', 'stdio', '--json')).code).toBe(1);
      const result = await fetch('http://127.0.0.1:' + port + '/list', { method: 'POST', body: JSON.stringify({ server: 'stdio' }) });
      expect(result.status).toBe(500);
      expect((await result.json()).error).toContain('disabled');
    } finally { await run('update', 'stdio', '--enabled'); }
  });
  it('rejects invalid CLI timeouts, invalid ports and unknown tools', async () => {
    expect((await run('call', 'stdio', 'echo', '--timeout', '-1')).code).toBe(1);
    expect((await run('start', '--port', '0')).code).toBe(1);
    expect((await run('call', 'stdio', 'missing', '--output-json')).code).toBe(1);
  });
  it('validates daemon request bodies without accepting malformed JSON', async () => {
    const result = await fetch('http://127.0.0.1:' + port + '/call', { method: 'POST', body: '{bad' });
    expect(result.status).toBe(400);
    expect((await result.json()).error).toBe('Invalid request JSON');
  });
});
