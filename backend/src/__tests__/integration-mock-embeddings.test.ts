import http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import axios from 'axios';

// Mock the OpenAI SDK so that `new OpenAI({ baseURL })` proxies to our local mock server
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      baseURL: string | undefined;
      constructor(opts: any) {
        this.baseURL = opts?.baseURL;
      }

      embeddings = {
        create: async ({ model, input }: any) => {
          const base = this.baseURL || 'http://127.0.0.1:11434';
          const resp = await axios.post(`${base}/v1/embeddings`, { model, input }, { timeout: 10000 });
          return resp.data;
        }
      };
    }
  };
});

let EmbeddingManager: any;

// Mutable config object used by mocked ConfigManager
const currentConfig: any = {};

vi.mock('../configManager', () => ({
  ConfigManager: class {
    getVectorConfig() {
      return currentConfig;
    }
  }
}));

describe('Integration mock embedding server', () => {
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test';

    // Simple HTTP server that emulates OpenAI and Ollama embedding endpoints
    server = http.createServer(async (req, res) => {
      try {
        if (!req.url) return res.end();
        const chunks: any[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};

        if (req.method === 'POST' && req.url === '/v1/embeddings') {
          // Emulate OpenAI: return an array of { embedding: [...] }
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          const data = inputs.map(() => ({ embedding: [0.4, 0.3, 0.2, 0.1] }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        }

        if (req.method === 'POST' && req.url === '/embeddings') {
          // Emulate Ollama: return { data: [[...], ...] }
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          const data = inputs.map(() => [0.25, 0.25, 0.25, 0.25]);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data }));
          return;
        }

        // default
        res.writeHead(404);
        res.end();
      } catch (e) {
        res.writeHead(500);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      server!.listen(0, '127.0.0.1', () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const addr: any = server!.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        // point ConfigManager to this server for both providers
        currentConfig.openaiBaseUrl = baseUrl;
        currentConfig.ollamaBaseUrl = baseUrl;
        resolve();
      });
    });

    // Import EmbeddingManager after server is started so mocked OpenAI can use the baseUrl
    EmbeddingManager = (await import('../utils/embeddingManager')).default;
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => {
      server!.close(() => {
        server = null;
        resolve();
      });
    });
  });

  beforeEach(() => {
    // Ensure test isolation for singleton manager
    EmbeddingManager.resetInstances();
  });

  it('returns embeddings from mocked OpenAI /v1/embeddings', async () => {
    const mgr = EmbeddingManager.getInstance('openai', 'test-model');

    const vec = await mgr.embedText('hello world');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBeGreaterThan(0);
    // vector should be normalized (non-zero)
    let norm = 0;
    for (const x of vec) norm += x * x;
    norm = Math.sqrt(norm);
    expect(norm).toBeGreaterThan(0);
  });

  it('returns embeddings from mocked Ollama /embeddings', async () => {
    const mgr = EmbeddingManager.getInstance('ollama', 'test-ollama');
    const vec = await mgr.embedText('hello ollama');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBeGreaterThan(0);
    let norm = 0;
    for (const x of vec) norm += x * x;
    norm = Math.sqrt(norm);
    expect(norm).toBeGreaterThan(0);
  });
});
