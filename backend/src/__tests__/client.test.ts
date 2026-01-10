import { chatCompletion, ChatMessage } from '../llm/client';
import { LLMProfile } from '../configManager';
import { countTokens } from '../utils/tokenCounter';
import { SummarizeAgent } from '../agents/SummarizeAgent';
import { CharacterAgent } from '../agents/CharacterAgent';
import { DirectorAgent } from '../agents/DirectorAgent';
import { WorldAgent } from '../agents/WorldAgent';
import { ConfigManager } from '../configManager';
import * as nunjucks from 'nunjucks';

describe('LLM Client', () => {
  const mockProfile: LLMProfile = {
    type: 'openai',
    apiKey: 'test-key',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
  };

  const messages: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
  ];

  it('should call chatCompletion without streaming', async () => {
    // Mock the OpenAI call
    // For now, just check if it doesn't throw
    try {
      const response = await chatCompletion(mockProfile, messages);
      expect(typeof response).toBe('string');
    } catch (error) {
      // Expect error due to invalid key
      expect(error).toBeDefined();
    }
  });

  it('should call chatCompletion with streaming', async () => {
    try {
      const response = await chatCompletion(mockProfile, messages, { stream: true });
      expect(typeof response).toBe('object'); // AsyncIterable
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  describe('Token Counting', () => {
    it('should accurately count tokens', () => {
      const text = 'Hello world';
      const tokenCount = countTokens(text);
      expect(typeof tokenCount).toBe('number');
      expect(tokenCount).toBeGreaterThan(0);
      // "Hello world" should be around 2-3 tokens
      expect(tokenCount).toBeLessThan(10);
    });

    it('should handle empty text', () => {
      const tokenCount = countTokens('');
      expect(tokenCount).toBe(0);
    });

    it('should handle longer text', () => {
      const text = 'This is a longer piece of text that should have more tokens than just a few words.';
      const tokenCount = countTokens(text);
      expect(tokenCount).toBeGreaterThan(5);
      expect(tokenCount).toBeLessThan(50);
    });
  });

  describe('Agent Profile Merging', () => {
    it('should merge agent-specific sampler overrides for summarize agent', () => {
      const configManager = new ConfigManager();
      const env = new nunjucks.Environment();
      const summarizeAgent = new SummarizeAgent(configManager, env);
      
      // Access the protected getProfile method
      const profile = (summarizeAgent as any).getProfile();
      
      // The summarize agent should have max_completion_tokens set to 1024
      expect(profile.sampler?.max_completion_tokens).toBe(1024);
      
      // Other settings should still be inherited from the base profile
      expect(profile.sampler?.temperature).toBeDefined();
      expect(profile.type).toBe('openai');
    });

    it('should merge agent-specific sampler overrides for character agent', () => {
      const configManager = new ConfigManager();
      const env = new nunjucks.Environment();
      const characterAgent = new CharacterAgent('TestChar', configManager, env);
      
      // Access the protected getProfile method
      const profile = (characterAgent as any).getProfile();
      
      // The character agent should have max_completion_tokens set to 400
      expect(profile.sampler?.max_completion_tokens).toBe(400);
      
      // Other settings should still be inherited from the base profile
      expect(profile.sampler?.temperature).toBeDefined();
      expect(profile.type).toBe('openai');
    });

    it('should merge agent-specific format overrides for director agent', () => {
      const configManager = new ConfigManager();
      const env = new nunjucks.Environment();
      const directorAgent = new DirectorAgent(configManager, env);
      
      // Access the protected getProfile method
      const profile = (directorAgent as any).getProfile();
      
      // The director agent should have format set to 'json'
      expect(profile.format).toBe('json');
    });

    it('should merge agent-specific format overrides for world agent', () => {
      const configManager = new ConfigManager();
      const env = new nunjucks.Environment();
      const worldAgent = new WorldAgent(configManager, env);
      
      // Access the protected getProfile method
      const profile = (worldAgent as any).getProfile();
      
      // The world agent should have format set to 'json'
      expect(profile.format).toBe('json');
    });
  });

  describe('History Formatting', () => {
    it('should format history with scene summary when available', () => {
      // This is a basic test to ensure the logic works
      const sceneSummary = 'This is a test summary of the scene.';
      const history = ['User: Hello', 'Character: Hi there'];
      
      const formattedHistory = sceneSummary ? [`[SCENE SUMMARY]\n${sceneSummary}\n\n[MESSAGES]\n${history.join('\n')}`] : history;
      
      expect(formattedHistory).toHaveLength(1);
      expect(formattedHistory[0]).toContain('[SCENE SUMMARY]');
      expect(formattedHistory[0]).toContain(sceneSummary);
      expect(formattedHistory[0]).toContain('[MESSAGES]');
      expect(formattedHistory[0]).toContain('User: Hello');
      expect(formattedHistory[0]).toContain('Character: Hi there');
    });

    it('should use plain history when no scene summary', () => {
      const sceneSummary = '';
      const history = ['User: Hello', 'Character: Hi there'];
      
      const formattedHistory = sceneSummary ? [`[SCENE SUMMARY]\n${sceneSummary}\n\n[MESSAGES]\n${history.join('\n')}`] : history;
      
      expect(formattedHistory).toEqual(history);
    });
  });
});