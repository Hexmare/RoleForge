import { describe, it, expect, vi } from 'vitest';

// Top-level controllable behavior objects for mocks
const openaiBehavior: any = { mode: 'idle', calls: 0 };
const axiosBehavior: any = { mode: 'idle', calls: 0 };

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      embeddings: any;
      constructor() {
        this.embeddings = {
          create: async ({ model, input }: any) => {
            openaiBehavior.calls = (openaiBehavior.calls || 0) + 1;
            if (openaiBehavior.mode === 'transient' && openaiBehavior.calls < (openaiBehavior.failCount || 3)) {
              const err: any = new Error('rate limited');
              err.response = { status: 429 };
              throw err;
            }
            if (openaiBehavior.mode === 'alwaysFail') {
              const err: any = new Error('server error');
              err.response = { status: 500 };
              throw err;
            }
            const inputs = Array.isArray(input) ? input : [input];
            return { data: inputs.map(() => ({ embedding: [0.4, 0.3, 0.2, 0.1] })) };
          }
        };
      }
    }
  };
});

vi.mock('axios', () => ({
  default: {
    post: async (url: string, body: any) => {
      axiosBehavior.calls = (axiosBehavior.calls || 0) + 1;
      if (axiosBehavior.mode === 'transient' && axiosBehavior.calls < (axiosBehavior.failCount || 3)) {
        const err: any = new Error('ECONNRESET');
        err.code = 'ECONNRESET';
        throw err;
      }
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return { data: { data: inputs.map(() => [0.25, 0.25, 0.25, 0.25]) } };
    }
  }
}));

import EmbeddingManager from '../utils/embeddingManager';

describe('EmbeddingManager retry behavior', () => {
  beforeEach(() => {
    openaiBehavior.mode = 'idle';
    openaiBehavior.calls = 0;
    openaiBehavior.failCount = 3;
    axiosBehavior.mode = 'idle';
    axiosBehavior.calls = 0;
    axiosBehavior.failCount = 3;
  });

  it('retries OpenAI calls and succeeds after transient 429 errors', async () => {
    openaiBehavior.mode = 'transient';
    openaiBehavior.failCount = 3; // fail twice, succeed on 3rd

    const mgr = EmbeddingManager.getInstance('openai', 'retry-model-openai-' + Date.now());
    const vec = await mgr.embedText('retry test openai');
    expect(Array.isArray(vec)).toBeTruthy();
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  it('retries Ollama HTTP calls and succeeds after transient network errors', async () => {
    axiosBehavior.mode = 'transient';
    axiosBehavior.failCount = 3;

    const mgr = EmbeddingManager.getInstance('ollama', 'retry-model-ollama-' + Date.now());
    const vec = await mgr.embedText('retry test ollama');
    expect(Array.isArray(vec)).toBeTruthy();
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  it('fails after exhausting retries for OpenAI', async () => {
    openaiBehavior.mode = 'alwaysFail';

    const mgr = EmbeddingManager.getInstance('openai', 'retry-model-openai-fail-' + Date.now());
    await expect(mgr.embedText('should fail')).rejects.toThrow();
  });
});

