import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mockStreamableHTTPConnect = vi.fn().mockResolvedValue(undefined);
const mockSSEConnect = vi.fn().mockResolvedValue(undefined);
let capturedStreamableHTTPUrl: URL | undefined;
let capturedStreamableHTTPOpts: any;
let capturedSSEUrl: URL | undefined;
let capturedSSEOpts: any;
vi.mock('@modelcontextprotocol/client', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, opts?: any) { capturedStreamableHTTPUrl = url; capturedStreamableHTTPOpts = opts; }
    start = mockStreamableHTTPConnect;
    close = vi.fn();
  },
  SSEClientTransport: class {
    constructor(url: URL, opts?: any) { capturedSSEUrl = url; capturedSSEOpts = opts; }
    start = mockSSEConnect;
    close = vi.fn();
  },
  Client: class {
    connect = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({ tools: [] });
    callTool = vi.fn().mockResolvedValue({ result: 'ok' });
    close = vi.fn().mockResolvedValue(undefined);
    setRequestHandler = vi.fn();
  },
}));
vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: class {
    start = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
}));
import { McpClientService } from '../../core/client.js';
import { detectServerType, HttpServerConfigSchema } from '../../types/config.js';

describe('detectServerType', () => {
  it('should detect http type for non-sse URLs', () => {
    expect(detectServerType({ url: 'http://localhost:8563/mcp' })).toBe('http');
  });

  it('should detect sse type for URLs ending with /sse', () => {
    expect(detectServerType({ url: 'http://localhost:3000/sse' })).toBe('sse');
  });

  it('should detect sse type for URLs containing /sse', () => {
    expect(detectServerType({ url: 'http://localhost:3000/sse?token=abc' })).toBe('sse');
  });

  it('should detect stdio type for command-based configs', () => {
    expect(detectServerType({ command: 'node', args: ['server.js'] })).toBe('stdio');
  });
});

describe('McpClientService - HTTP headers support', () => {
  let service: McpClientService;

  beforeEach(() => {
    service = new McpClientService();
    capturedStreamableHTTPUrl = undefined;
    capturedStreamableHTTPOpts = undefined;
    capturedSSEUrl = undefined;
    capturedSSEOpts = undefined;
  });

  afterEach(() => {
    service.close();
  });

  describe('StreamableHTTP transport', () => {
    it('should pass headers to StreamableHTTPClientTransport', async () => {
      await service.connect({
        url: 'http://localhost:8563/mcp',
        headers: {
          'Authorization': 'Bearer test-token-123',
          'X-Custom-Header': 'custom-value'
        }
      }, 'test-http');

      expect(capturedStreamableHTTPUrl?.toString()).toBe('http://localhost:8563/mcp');
      expect(capturedStreamableHTTPOpts).toBeDefined();
      expect(capturedStreamableHTTPOpts.requestInit).toBeDefined();
      expect(capturedStreamableHTTPOpts.requestInit.headers).toEqual({
        'Authorization': 'Bearer test-token-123',
        'X-Custom-Header': 'custom-value'
      });
    });

    it('should work without headers', async () => {
      await service.connect({
        url: 'http://localhost:8563/mcp'
      }, 'test-http-no-headers');

      expect(capturedStreamableHTTPUrl?.toString()).toBe('http://localhost:8563/mcp');
      expect(capturedStreamableHTTPOpts).toBeDefined();
      // requestInit should exist but headers should be empty/undefined
      expect(capturedStreamableHTTPOpts.requestInit.headers).toBeUndefined();
    });

    it('should resolve env placeholders in header values', async () => {
      process.env.TEST_TOKEN = 'resolved-token-value';

      await service.connect({
        url: 'http://localhost:8563/mcp',
        headers: {
          'Authorization': 'Bearer ${TEST_TOKEN}'
        }
      }, 'test-http-env');

      expect(capturedStreamableHTTPOpts.requestInit.headers).toEqual({
        'Authorization': 'Bearer resolved-token-value'
      });

      delete process.env.TEST_TOKEN;
    });

    it('should throw on missing env variable in headers', async () => {
      delete process.env.NONEXISTENT_VAR;

      await expect(service.connect({
        url: 'http://localhost:8563/mcp',
        headers: {
          'Authorization': 'Bearer ${NONEXISTENT_VAR}'
        }
      }, 'test-http-missing-env')).rejects.toThrow('Missing environment variables');
    });
  });

  describe('SSE transport', () => {
    it('should pass headers to SSEClientTransport', async () => {
      await service.connect({
        url: 'http://localhost:3000/sse',
        headers: {
          'Authorization': 'Bearer sse-token',
          'X-API-Key': 'api-key-123'
        }
      }, 'test-sse');

      expect(capturedSSEUrl?.toString()).toBe('http://localhost:3000/sse');
      expect(capturedSSEOpts).toBeDefined();
      expect(capturedSSEOpts.requestInit).toBeDefined();
      expect(capturedSSEOpts.requestInit.headers).toEqual({
        'Authorization': 'Bearer sse-token',
        'X-API-Key': 'api-key-123'
      });
    });

    it('should work without headers for SSE', async () => {
      await service.connect({
        url: 'http://localhost:3000/sse'
      }, 'test-sse-no-headers');

      expect(capturedSSEUrl?.toString()).toBe('http://localhost:3000/sse');
      expect(capturedSSEOpts).toBeDefined();
      expect(capturedSSEOpts.requestInit.headers).toBeUndefined();
    });

    it('should resolve env placeholders in SSE header values', async () => {
      process.env.SSE_SECRET = 'my-sse-secret';

      await service.connect({
        url: 'http://localhost:3000/sse',
        headers: {
          'X-Secret': '${SSE_SECRET}'
        }
      }, 'test-sse-env');

      expect(capturedSSEOpts.requestInit.headers).toEqual({
        'X-Secret': 'my-sse-secret'
      });

      delete process.env.SSE_SECRET;
    });
  });
});

describe('HttpServerConfigSchema - headers validation', () => {

  it('should accept config with headers', () => {
    const config = {
      url: 'http://localhost:8563/mcp',
      headers: {
        'Authorization': 'Bearer token123'
      }
    };
    const result = HttpServerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept config without headers', () => {
    const config = {
      url: 'http://localhost:8563/mcp'
    };
    const result = HttpServerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept config with type field', () => {
    const config = {
      url: 'http://localhost:8563/mcp',
      type: 'streamableHttp'
    };
    const result = HttpServerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept config with all optional fields', () => {
    const config = {
      url: 'http://localhost:8563/mcp',
      type: 'http',
      headers: {
        'Authorization': 'Bearer token',
        'X-Custom': 'value'
      },
      disabled: false,
      autoApprove: ['*']
    };
    const result = HttpServerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject config with invalid type value', () => {
    const config = {
      url: 'http://localhost:8563/mcp',
      type: 'invalid-type'
    };
    const result = HttpServerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject config with non-string header values', () => {
    const config = {
      url: 'http://localhost:8563/mcp',
      headers: {
        'Authorization': 123
      }
    };
    const result = HttpServerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
