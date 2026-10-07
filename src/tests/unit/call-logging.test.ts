import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { McpClientService } from '../../core/client.js';
import { printResult } from '../../commands/call.js';

describe('actual tool calls, logging and result rendering', () => {
  let service: McpClientService;
  beforeEach(async () => {
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
    vi.spyOn(Client.prototype, 'close').mockResolvedValue();
    vi.spyOn(Client.prototype, 'callTool').mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    service = new McpClientService();
    await service.connect({ url: 'https://example.org/mcp' }, 'server');
  });
  afterEach(async () => { await service.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('passes the tool, arguments, timeout and continuation to the SDK', async () => {
    await service.callTool('echo', { text: 'hello' }, 1200, { requestState: 'opaque' });
    expect(Client.prototype.callTool).toHaveBeenCalledWith(
      { name: 'echo', arguments: { text: 'hello' }, requestState: 'opaque' },
      { timeout: 1200, maxTotalTimeout: 1200, allowInputRequired: true },
    );
  });
  it('logs actual requests only in verbose mode without logging sensitive arguments or results', async () => {
    vi.stubEnv('MCPS_VERBOSE', 'true');
    await service.callTool('echo', { token: 'private-test-value' });
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('[Tool Request] Server: server, Tool: echo');
    expect(output).toContain('[Tool Response] Server: server, Tool: echo');
    expect(output).not.toContain('private-test-value');
    expect(output).not.toContain('result');
  });
  it('keeps normal tool calls quiet', async () => {
    vi.stubEnv('MCPS_VERBOSE', 'false');
    await service.callTool('echo', {});
    expect(console.log).not.toHaveBeenCalled();
  });
  it('renders audio, resource links, embedded text and non-object structured content', () => {
    printResult({ content: [
      { type: 'audio', mimeType: 'audio/wav', data: 'abc' },
      { type: 'resource_link', uri: 'test://resource' },
      { type: 'resource', resource: { uri: 'test://embedded', text: 'embedded text' } },
    ], structuredContent: [1, 2] });
    expect(vi.mocked(console.log).mock.calls.flat()).toEqual(['[Audio: audio/wav]', '[Resource: test://resource]', 'embedded text', '[\n  1,\n  2\n]']);
  });
  it('preserves input-required state in rendering', () => {
    const result = { resultType: 'input_required', requestState: 'opaque', inputRequests: {} };
    printResult(result);
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual(result);
  });
});
