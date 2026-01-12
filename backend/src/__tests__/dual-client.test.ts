import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as nunjucks from 'nunjucks';

// Import the components we're testing
import { customLLMRequest } from '../llm/customClient';
import { LLMProfile } from '../configManager';

// Mock axios at the module level
vi.mock('axios');
import axios from 'axios';
const mockedAxios = vi.mocked(axios, { partial: true });

/**
 * Test Suite: Dual-Client LLM Architecture
 * Tests the routing between OpenAI SDK (for 'openai' profiles) and axios (for 'custom' profiles).
 */
describe('Dual-Client LLM Architecture', () => {
  const templatesDir = path.join(dirname(fileURLToPath(import.meta.url)), '..', 'llm_templates');
  let env: nunjucks.Environment;

  beforeEach(() => {
    // Setup Nunjucks environment
    env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(templatesDir),
      { autoescape: false }
    );
    
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Template Rendering', () => {
    it('should render ChatML template with proper format', () => {
      const systemPrompt = 'You are a helpful assistant';
      const userMessage = 'Hello!';
      const assistantMessage = 'Hi there!';

      const template = fs.readFileSync(
        path.join(templatesDir, 'chatml.njk'),
        'utf-8'
      );
      const rendered = env.renderString(template, {
        system_prompt: systemPrompt,
        user_message: userMessage,
        assistant_message: assistantMessage,
      });

      // Verify ChatML format
      expect(rendered).toContain('<|im_start|>system');
      expect(rendered).toContain('<|im_start|>user');
      expect(rendered).toContain('<|im_start|>assistant');
      expect(rendered).toContain('<|im_end|>');
      expect(rendered).toContain(systemPrompt);
      expect(rendered).toContain(userMessage);
      expect(rendered).toContain(assistantMessage);
    });

    it('should render Alpaca template with proper format', () => {
      const systemPrompt = 'You are a helpful assistant';
      const userMessage = 'Describe something';
      const assistantMessage = 'Here is a description...';

      const template = fs.readFileSync(
        path.join(templatesDir, 'alpaca.njk'),
        'utf-8'
      );
      const rendered = env.renderString(template, {
        system_prompt: systemPrompt,
        user_message: userMessage,
        assistant_message: assistantMessage,
      });

      // Verify Alpaca format
      expect(rendered).toContain('### Instruction:');
      expect(rendered).toContain('### Input:');
      expect(rendered).toContain('### Response:');
      expect(rendered).toContain(systemPrompt);
      expect(rendered).toContain(userMessage);
      expect(rendered).toContain(assistantMessage);
    });

    it('should render Vicuna template with proper format', () => {
      const systemPrompt = 'You are a helpful assistant';
      const userMessage = 'Hello!';
      const assistantMessage = 'Hello!';

      const template = fs.readFileSync(
        path.join(templatesDir, 'vicuna.njk'),
        'utf-8'
      );
      const rendered = env.renderString(template, {
        system_prompt: systemPrompt,
        user_message: userMessage,
        assistant_message: assistantMessage,
      });

      // Verify Vicuna format
      expect(rendered).toContain('USER:');
      expect(rendered).toContain('ASSISTANT:');
      expect(rendered).toContain(systemPrompt);
      expect(rendered).toContain(userMessage);
      expect(rendered).toContain(assistantMessage);
    });

    it('should render Llama2 template with proper format', () => {
      const systemPrompt = 'You are a helpful assistant';
      const userMessage = 'Hello!';
      const assistantMessage = 'Hello!';

      const template = fs.readFileSync(
        path.join(templatesDir, 'llama2.njk'),
        'utf-8'
      );
      const rendered = env.renderString(template, {
        system_prompt: systemPrompt,
        user_message: userMessage,
        assistant_message: assistantMessage,
      });

      // Verify Llama2 format
      expect(rendered).toContain('[INST]');
      expect(rendered).toContain('<<SYS>>');
      expect(rendered).toContain('<</SYS>>');
      expect(rendered).toContain('[/INST]');
      expect(rendered).toContain(systemPrompt);
      expect(rendered).toContain(userMessage);
      expect(rendered).toContain(assistantMessage);
    });
  });

  describe('Custom LLM Client (Axios)', () => {
    it('should successfully call custom LLM endpoint with rendered prompt', async () => {
      const mockProfile: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'alpaca-7b',
        apiKey: 'test-key',
        template: 'alpaca',
        sampler: {
          max_completion_tokens: 256,
          temperature: 0.7,
          topP: 0.9,
        },
      };

      const renderedPrompt = 'Below is an instruction...\n### Input:\nHello\n### Response:';

      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: {
          choices: [{ text: 'This is the response' }],
        },
      });

      const response = await customLLMRequest(mockProfile, renderedPrompt);

      expect(response).toBe('This is the response');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:8000/completions',
        expect.objectContaining({
          prompt: renderedPrompt,
          model: 'alpaca-7b',
          temperature: 0.7,
          top_p: 0.9,
        }),
        expect.any(Object)
      );
    });

    it('should include sampler settings in request body', async () => {
      const mockProfile: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:5000',
        model: 'llama2-7b',
        template: 'llama2',
        sampler: {
          max_completion_tokens: 512,
          temperature: 0.8,
          topP: 0.95,
          frequencyPenalty: 0.5,
          presencePenalty: 0.2,
          stop: ['</s>', '[END]'],
        },
      };

      const renderedPrompt = '[INST] Hello [/INST]';

      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: { choices: [{ text: 'Response' }] },
      });

      await customLLMRequest(mockProfile, renderedPrompt);

      const callArgs = (mockedAxios.post as any).mock.calls[0][1] as any;
      expect(callArgs.temperature).toBe(0.8);
      expect(callArgs.top_p).toBe(0.95);
      expect(callArgs.frequency_penalty).toBe(0.5);
      expect(callArgs.presence_penalty).toBe(0.2);
      expect(callArgs.stop).toEqual(['</s>', '[END]']);
      expect(callArgs.max_tokens).toBe(512);
    });

    it('should handle alternative response formats', async () => {
      const mockProfile: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'alpaca-7b',
        template: 'alpaca',
      };

      const renderedPrompt = 'Test prompt';

      // Test 'result' format
      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: { result: 'Response from result field' },
      });

      let response = await customLLMRequest(mockProfile, renderedPrompt);
      expect(response).toBe('Response from result field');

      // Test 'message.content' format
      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'Response from message.content' } }],
        },
      });

      response = await customLLMRequest(mockProfile, renderedPrompt);
      expect(response).toBe('Response from message.content');
    });

    it('should include Bearer token in Authorization header when apiKey provided', async () => {
      const mockProfile: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'alpaca-7b',
        apiKey: 'secret-token-123',
        template: 'alpaca',
      };

      mockedAxios.post = vi.fn().mockResolvedValueOnce({
        data: { choices: [{ text: 'Response' }] },
      });

      await customLLMRequest(mockProfile, 'Test prompt');

      const config = (mockedAxios.post as any).mock.calls[0][2] as any;
      expect(config.headers.Authorization).toBe('Bearer secret-token-123');
    });

    it('should handle HTTP errors gracefully', async () => {
      const mockProfile: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'alpaca-7b',
        template: 'alpaca',
      };

      const error = new Error('Network error');
      (error as any).response = {
        data: { error: { message: 'Model not found' } },
      };

      mockedAxios.post = vi.fn().mockRejectedValueOnce(error);

      await expect(customLLMRequest(mockProfile, 'Test prompt')).rejects.toThrow();
    });
  });

  describe('Profile Type Routing', () => {
    it('should identify custom profile type correctly', () => {
      const customProfile: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'alpaca-7b',
        template: 'alpaca',
      };

      expect(customProfile.type).toBe('custom');
    });

    it('should identify openai profile type correctly', () => {
      const openaiProfile: LLMProfile = {
        type: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4',
        apiKey: 'sk-...',
        template: 'chatml',
      };

      expect(openaiProfile.type).toBe('openai');
    });

    it('should preserve template selection across profile types', () => {
      const customWithAlpaca: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'alpaca-7b',
        template: 'alpaca',
      };

      const customWithVicuna: LLMProfile = {
        type: 'custom',
        baseURL: 'http://localhost:8000',
        model: 'vicuna-7b',
        template: 'vicuna',
      };

      expect(customWithAlpaca.template).toBe('alpaca');
      expect(customWithVicuna.template).toBe('vicuna');
    });
  });

  describe('Template Format Integrity', () => {
    it('should not mix ChatML delimiters with other template formats', () => {
      const alpacaTemplate = fs.readFileSync(
        path.join(templatesDir, 'alpaca.njk'),
        'utf-8'
      );
      const vicunaTemplate = fs.readFileSync(
        path.join(templatesDir, 'vicuna.njk'),
        'utf-8'
      );
      const llama2Template = fs.readFileSync(
        path.join(templatesDir, 'llama2.njk'),
        'utf-8'
      );

      // Non-ChatML templates should NOT contain ChatML delimiters
      expect(alpacaTemplate).not.toContain('<|im_start|>');
      expect(alpacaTemplate).not.toContain('<|im_end|>');
      expect(vicunaTemplate).not.toContain('<|im_start|>');
      expect(vicunaTemplate).not.toContain('<|im_end|>');
      expect(llama2Template).not.toContain('<|im_start|>');
      expect(llama2Template).not.toContain('<|im_end|>');
    });

    it('should use format-specific delimiters correctly', () => {
      const alpacaTemplate = fs.readFileSync(
        path.join(templatesDir, 'alpaca.njk'),
        'utf-8'
      );
      const vicunaTemplate = fs.readFileSync(
        path.join(templatesDir, 'vicuna.njk'),
        'utf-8'
      );
      const llama2Template = fs.readFileSync(
        path.join(templatesDir, 'llama2.njk'),
        'utf-8'
      );

      // Alpaca uses ### delimiters
      expect(alpacaTemplate).toContain('### Instruction:');
      expect(alpacaTemplate).toContain('### Input:');
      expect(alpacaTemplate).toContain('### Response:');

      // Vicuna uses USER: / ASSISTANT:
      expect(vicunaTemplate).toContain('USER:');
      expect(vicunaTemplate).toContain('ASSISTANT:');

      // Llama2 uses [INST] tags
      expect(llama2Template).toContain('[INST]');
      expect(llama2Template).toContain('[/INST]');
      expect(llama2Template).toContain('<<SYS>>');
    });
  });
});
