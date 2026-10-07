import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const fixture = path.join(repository, 'src/tests/fixtures/mcp-server.mjs');
export async function runCli(args: string[], env: Record<string, string> = {}) {
  try {
    const result = await promisify(execFile)(process.execPath, ['dist/index.js', ...args], { cwd: repository, env: { ...process.env, ...env }, timeout: 20000 });
    return { ...result, code: 0 };
  } catch (error: any) {
    if (error.killed || typeof error.code !== 'number') throw error;
    return { stdout: error.stdout as string, stderr: error.stderr as string, code: error.code as number };
  }
}
export async function startFixture(transport: 'http' | 'sse', env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [fixture, transport], { cwd: repository, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Fixture startup timed out: ' + errors)); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Fixture exited: ' + code + ' ' + errors)); });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.trim()).port); }
    });
  });
  return { child, port, url: 'http://127.0.0.1:' + port + (transport === 'sse' ? '/events' : '/mcp') };
}
export async function stopFixture(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}
export async function freePort() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
export async function waitForDaemonExit(port: number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const running = await fetch('http://127.0.0.1:' + port + '/status', { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
    if (!running) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Daemon did not exit');
}
