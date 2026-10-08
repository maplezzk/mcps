import http from 'node:http';
import fs from 'node:fs';
import { McpServer, ResourceTemplate, completable, createMcpHandler, inputRequired } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const [transport = 'stdio', era = 'modern'] = process.argv.slice(2);
let toolAdded = false;
const echo = text => ({ text, cwd: process.cwd(), empty: process.env.FIXTURE_EMPTY ?? 'unset', pid: process.pid });
const definitions = [
  { name: 'echo', description: 'Echo with process context', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'rich', description: 'Modern content and array output', inputSchema: { type: 'object' }, outputSchema: { type: 'array', items: { type: 'number' } } },
  { name: 'fail', inputSchema: { type: 'object' } },
  { name: 'confirm', inputSchema: { type: 'object' } },
  { name: 'add_tool', inputSchema: { type: 'object' } },
];

function factory() {
  const server = new McpServer({ name: 'mcps-protocol-fixture', version: '1.0.0' }, {
    requestState: { verify: value => {
      if (value !== 'approval-step') throw new Error('Invalid request state');
      return { step: 'approval' };
    } },
  });
  server.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({
    content: [{ type: 'text', text: JSON.stringify(echo(text)) }],
    structuredContent: echo(text),
  }));
  server.registerTool('rich', { outputSchema: z.array(z.number()) }, async () => ({
    content: [
      { type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' },
      { type: 'resource_link', name: 'document', uri: 'fixture://document', description: 'Test document' },
      { type: 'resource', resource: { uri: 'fixture://embedded', mimeType: 'text/plain', text: 'embedded text' } },
    ],
    structuredContent: [1, 2, 3],
    _meta: { 'org.example/fixture': true },
  }));
  server.registerTool('fail', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'deliberate tool failure' }] }));
  server.registerTool('confirm', { inputSchema: z.object({}) }, async (_args, ctx) => {
    const response = ctx.mcpReq.inputResponses?.approval;
    if (!response) return inputRequired({
      inputRequests: { approval: inputRequired.elicit({ message: 'Approve this fixture action?', requestedSchema: z.object({ approved: z.boolean() }) }) },
      requestState: 'approval-step',
    });
    const state = ctx.mcpReq.requestState();
    if (state?.step !== 'approval') throw new Error('Continuation state was not preserved');
    return { content: [{ type: 'text', text: response.action === 'accept' && response.content?.approved === true ? 'approved' : 'declined' }] };
  });
  const add = () => server.registerTool('added', {}, async () => ({ content: [{ type: 'text', text: 'new tool' }] }));
  if (toolAdded) add();
  server.registerTool('add_tool', {}, async () => {
    if (!toolAdded) { toolAdded = true; add(); }
    return { content: [{ type: 'text', text: 'added' }] };
  });
  // Exercise actual cursor pagination, rather than returning a single in-memory list.
  server.server.setRequestHandler('tools/list', async request => {
    const all = toolAdded ? [...definitions, { name: 'added', inputSchema: { type: 'object' } }] : definitions;
    return request.params?.cursor ? { tools: all.slice(2) } : { tools: all.slice(0, 2), nextCursor: 'page-2' };
  });
  server.registerResource('document', 'fixture://document', { mimeType: 'text/plain' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'fixture document' }],
  }));
  server.registerResource('item', new ResourceTemplate('fixture://items/{name}', { list: undefined }), {}, async (uri, variables) => ({
    contents: [{ uri: uri.href, text: String(variables.name) }],
  }));
  server.registerPrompt('welcome', { argsSchema: z.object({
    name: completable(z.string(), value => ['Taipei', 'Tokyo'].filter(city => city.startsWith(value))),
  }) }, async ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Hello ' + name } }] }));
  return server;
}

async function legacyFactory() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({ name: 'mcps-legacy-fixture', version: '1.0.0' });
  server.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => ({
    content: [{ type: 'text', text: JSON.stringify(echo(text)) }],
  }));
  server.registerTool('confirm', { inputSchema: {} }, async () => {
    const result = await server.server.elicitInput({ message: 'Legacy approval?', requestedSchema: { type: 'object', properties: { approved: { type: 'boolean' } } } });
    return { content: [{ type: 'text', text: result.action }] };
  });
  return server;
}

if (transport === 'stdio') {
  if (era === 'legacy') {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    await (await legacyFactory()).connect(new StdioServerTransport());
  } else serveStdio(factory);
} else if (transport === 'http') {
  const handler = createMcpHandler(factory);
  const listener = toNodeHandler(handler);
  const server = http.createServer(async (request, response) => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.url?.startsWith('/.well-known/oauth-protected-resource')) {
      json({ resource: base + '/oauth/mcp', authorization_servers: [base + '/issuer'], scopes_supported: ['mcp:read'] }); return;
    }
    if (request.url?.includes('.well-known/oauth-authorization-server') || request.url?.includes('.well-known/openid-configuration')) {
      json({ issuer: base + '/issuer', authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', response_types_supported: ['code'], grant_types_supported: ['client_credentials'], token_endpoint_auth_methods_supported: ['client_secret_basic'] }); return;
    }
    if (request.url === '/token') {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      if (request.headers.authorization !== 'Basic ' + Buffer.from('fixture-client:fixture-secret').toString('base64') || new URLSearchParams(body).get('grant_type') !== 'client_credentials') {
        response.statusCode = 401; json({ error: 'invalid_client' }); return;
      }
      json({ access_token: 'fixture-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'mcp:read' }); return;
    }
    if (request.url === '/oauth/mcp' && request.headers.authorization !== 'Bearer fixture-access-token') {
      response.setHeader('WWW-Authenticate', 'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource/oauth/mcp"');
      response.statusCode = 401; json({ error: 'unauthorized' }); return;
    }
    if (request.url === '/denied') { response.writeHead(401); response.end(); return; }
    if (process.env.FIXTURE_REQUEST_LOG && request.method === 'POST') {
      // Capture non-secret wire metadata for protocol conformance assertions.
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString());
      fs.appendFileSync(process.env.FIXTURE_REQUEST_LOG, JSON.stringify({ method: body.method, meta: body.params?._meta, protocolHeader: request.headers['mcp-protocol-version'], sessionHeader: request.headers['mcp-session-id'], authorization: request.headers['x-fixture-token'] }) + '\n');
      request.body = body;
      // The Node adapter accepts a pre-parsed body as its third argument.
      await listener(request, response, body);
    } else await listener(request, response);
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
} else if (transport === 'sse') {
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
  let channel;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/events' && request.method === 'GET') {
      channel = new SSEServerTransport('/messages', response);
      await (await legacyFactory()).connect(channel);
    } else if (request.url?.startsWith('/messages') && request.method === 'POST' && channel) {
      await channel.handlePostMessage(request, response);
    } else { response.writeHead(404); response.end(); }
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
}
