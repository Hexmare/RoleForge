import { describe, it, expect, vi } from 'vitest';
import EmbeddingManager from '../utils/embeddingManager';

// Mock OpenAI client
vi.mock('openai', () => {
  return {
    default: class OpenAI {
      embeddings: any;
      constructor(opts: any) {
        this.embeddings = {
          create: async ({ model, input }: any) => {
            const inputs = Array.isArray(input) ? input : [input];
            return { data: inputs.map(() => ({ embedding: [0.1, 0.2, 0.3, 0.4] })) };
          }
        };
      }
    }
  };
});

// Mock axios for Ollama
vi.mock('axios', () => ({
  default: {
    post: async (url: string, body: any) => {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return { data: { data: inputs.map(() => [0.2, 0.3, 0.4, 0.1]) } };
    }
  }
}));

describe('EmbeddingManager provider mocks', () => {
  it('openai provider returns normalized vector', async () => {
    const mgr = EmbeddingManager.getInstance('openai', 'test-openai-model');
    const vec = await mgr.embedText('hello world');
    expect(Array.isArray(vec)).toBeTruthy();
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  it('ollama provider returns normalized vector', async () => {
    const mgr = EmbeddingManager.getInstance('ollama', 'test-ollama-model');
    const vec = await mgr.embedText('hello ollama');
    expect(Array.isArray(vec)).toBeTruthy();
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });
});
