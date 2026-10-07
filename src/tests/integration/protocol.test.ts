import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpClientService } from '../../core/client.js';
import { fixture, startFixture, stopFixture } from './helpers.js';

describe('real MCP SDK interoperability', () => {
  let directory: string;
  let http: Awaited<ReturnType<typeof startFixture>>;
  let sse: Awaited<ReturnType<typeof startFixture>>;
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcps-protocol-'));
    http = await startFixture('http', { FIXTURE_REQUEST_LOG: path.join(directory, 'requests.jsonl') });
    sse = await startFixture('sse');
  });
  afterAll(async () => {
    if (http) await stopFixture(http.child);
    if (sse) await stopFixture(sse.child);
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  it('negotiates latest stdio, honors cwd/env, aggregates every tool page and closes the exact child', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ command: process.execPath, args: [fixture], cwd: directory, env: { FIXTURE_EMPTY: '' } }, 'stdio');
      expect(client.getInfo()).toMatchObject({ protocolVersion: '2026-07-28', protocolEra: 'modern' });
      const { tools } = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['echo', 'rich', 'fail', 'confirm', 'add_tool']);
      const result = await client.callTool('echo', { text: 'hello' });
      expect(result.structuredContent).toMatchObject({ text: 'hello', cwd: directory, empty: '' });
      await client.callTool('add_tool', {});
      expect((await client.listTools()).tools.some(tool => tool.name === 'added')).toBe(true);
    } finally { await client.close(); }
    await expect(client.listTools()).rejects.toThrow('Client not connected');
  });
  it('falls back to the actual v1 stdio server without losing interoperability', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ command: process.execPath, args: [fixture, 'stdio', 'legacy'] }, 'legacy');
      expect(client.getInfo()).toMatchObject({ protocolVersion: '2025-11-25', protocolEra: 'legacy' });
      const result = await client.callTool('echo', { text: 'old server' });
      expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('old server') });
      expect((await client.callTool('confirm', {})).content[0]).toMatchObject({ type: 'text', text: 'cancel' });
    } finally { await client.close(); }
  });
  it('rejects a modern-only pin against an old server', async () => {
    const client = new McpClientService();
    try {
      await expect(client.connect({ command: process.execPath, args: [fixture, 'stdio', 'legacy'], protocolVersion: '2026-07-28' })).rejects.toThrow();
    } finally { await client.close(); }
  });
  it('uses stateless HTTP with per-request metadata and header authentication', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ url: http.url, type: 'http', headers: { 'X-Fixture-Token': 'non-secret-test-token' } });
      await client.listTools();
      await client.callTool('echo', { text: 'modern HTTP' });
      expect(client.getInfo()).toMatchObject({ protocolVersion: '2026-07-28', protocolEra: 'modern' });
      const requests = fs.readFileSync(path.join(directory, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(requests.some(request => request.method === 'server/discover')).toBe(true);
      expect(requests.some(request => request.method === 'subscriptions/listen')).toBe(true);
      expect(requests.some(request => request.method === 'initialize')).toBe(false);
      for (const request of requests) {
        expect(request.meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
        expect(request.meta['io.modelcontextprotocol/clientCapabilities'].elicitation).toEqual({ form: {}, url: {} });
        expect(request.protocolHeader).toBe('2026-07-28');
        expect(request.sessionHeader).toBeUndefined();
        expect(request.authorization).toBe('non-secret-test-token');
      }
    } finally { await client.close(); }
  });
  it('does not disguise an HTTP authorization error as a legacy server', async () => {
    const client = new McpClientService();
    try { await expect(client.connect({ url: http.url.replace('/mcp', '/denied') })).rejects.toThrow(); }
    finally { await client.close(); }
  });
  it('preserves legacy SSE at an endpoint without /sse in its URL', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ url: sse.url, type: 'sse' }, 'sse');
      expect(client.getInfo().protocolEra).toBe('legacy');
      expect((await client.listTools()).tools[0].name).toBe('echo');
    } finally { await client.close(); }
  });
  it('preserves arbitrary structured output, audio, resource links and metadata', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ url: http.url });
      await client.listTools();
      const result = await client.callTool('rich', {});
      expect(result.structuredContent).toEqual([1, 2, 3]);
      expect(result._meta?.['org.example/fixture']).toBe(true);
      expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'audio' }), expect.objectContaining({ type: 'resource_link' })]));
    } finally { await client.close(); }
  });
  it('reads resources/templates, gets prompts and requests completion', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ url: http.url });
      expect(await client.request('resources/list')).toMatchObject({ resources: [expect.objectContaining({ uri: 'fixture://document' })] });
      expect(await client.request('resources/templates/list')).toMatchObject({ resourceTemplates: [expect.objectContaining({ uriTemplate: 'fixture://items/{name}' })] });
      expect(await client.request('resources/read', { uri: 'fixture://document' })).toMatchObject({ contents: [expect.objectContaining({ text: 'fixture document' })] });
      expect(await client.request('prompts/list')).toMatchObject({ prompts: [expect.objectContaining({ name: 'welcome' })] });
      expect(await client.request('prompts/get', { name: 'welcome', arguments: { name: 'Taipei' } })).toMatchObject({ messages: [expect.objectContaining({ content: { type: 'text', text: 'Hello Taipei' } })] });
      expect(await client.request('completion/complete', { ref: { type: 'ref/prompt', name: 'welcome' }, argument: { name: 'name', value: 'T' } })).toMatchObject({ completion: { values: ['Taipei', 'Tokyo'] } });
    } finally { await client.close(); }
  });
  it('surfaces input-required results and retries with exact opaque request state', async () => {
    const client = new McpClientService();
    try {
      await client.connect({ url: http.url });
      const first: any = await client.callTool('confirm', {});
      expect(first).toMatchObject({ resultType: 'input_required', requestState: 'approval-step', inputRequests: { approval: expect.any(Object) } });
      const result = await client.callTool('confirm', {}, 3000, { requestState: first.requestState, inputResponses: { approval: { action: 'accept', content: { approved: true } } } });
      expect(result.content).toEqual([{ type: 'text', text: 'approved' }]);
    } finally { await client.close(); }
  });
  it('discovers OAuth metadata and authenticates using issuer-bound client credentials', async () => {
    const client = new McpClientService();
    const previous = process.env.MCPS_FIXTURE_SECRET;
    process.env.MCPS_FIXTURE_SECRET = 'fixture-secret';
    try {
      await client.connect({ url: http.url.replace('/mcp', '/oauth/mcp'), auth: { type: 'client_credentials', clientId: 'fixture-client', clientSecretEnv: 'MCPS_FIXTURE_SECRET', issuer: http.url.replace('/mcp', '/issuer'), scope: 'mcp:read' } });
      expect(client.getInfo().protocolVersion).toBe('2026-07-28');
      expect((await client.listTools()).tools).toHaveLength(5);
    } finally {
      await client.close();
      if (previous === undefined) delete process.env.MCPS_FIXTURE_SECRET;
      else process.env.MCPS_FIXTURE_SECRET = previous;
    }
  });
});
