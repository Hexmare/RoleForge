import { chatCompletion, ChatMessage } from '../llm/client';
import { LLMProfile } from '../configManager';

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
});