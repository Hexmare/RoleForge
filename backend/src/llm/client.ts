import OpenAI from 'openai';
import axios from 'axios';
import { LLMProfile } from '../configManager';
import { countTokens } from '../utils/tokenCounter.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function estimateTokens(text: string): number {
  return countTokens(text);
}

function trimMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (!maxTokens || messages.length <= 2) return messages; // Keep at least system + current user

  // Find system message and current user message (last user message)
  const systemMessage = messages.find(msg => msg.role === 'system');
  const userMessages = messages.filter(msg => msg.role === 'user');
  const currentUserMessage = userMessages[userMessages.length - 1];

  if (!systemMessage || !currentUserMessage) return messages;

  // Base tokens: system + current user
  const baseTokens = estimateTokens(systemMessage.content) + estimateTokens(currentUserMessage.content);
  const availableTokens = maxTokens - baseTokens;

  if (availableTokens <= 0) {
    // Not enough room, return just base
    return [systemMessage, currentUserMessage];
  }

  // Build trimmed messages: system + history (from most recent) + current user
  const trimmed: ChatMessage[] = [systemMessage];
  let usedTokens = baseTokens;

  // Get history messages (everything except system and current user)
  const historyMessages = messages.filter(msg => msg !== systemMessage && msg !== currentUserMessage);

  // Add history from the end (most recent first)
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i];
    const msgTokens = estimateTokens(msg.content);
    if (usedTokens + msgTokens <= maxTokens) {
      trimmed.splice(1, 0, msg); // Insert after system
      usedTokens += msgTokens;
    } else {
      break;
    }
  }

  // Add current user
  trimmed.push(currentUserMessage);

  return trimmed;
}

export async function chatCompletion(
  profile: LLMProfile,
  messages: ChatMessage[],
  options: { stream?: boolean } = {}
): Promise<string | AsyncIterable<string>> {

  // OpenAI compatible
  const client = new OpenAI({
    apiKey: profile.apiKey || 'dummy',
    baseURL: profile.baseURL,
  });

  const model = profile.model || 'gpt-3.5-turbo';

  // Trim messages based on max context tokens
  const trimmedMessages = trimMessages(messages, profile.sampler?.maxContextTokens || 0);

  const samplerOptions = profile.sampler ? {
    temperature: profile.sampler.temperature,
    top_p: profile.sampler.topP,               // correct name for the API
    max_completion_tokens: profile.sampler.max_completion_tokens,
    frequency_penalty: profile.sampler.frequencyPenalty,
    presence_penalty: profile.sampler.presencePenalty,
    stop: profile.sampler.stop,
    n: profile.sampler.n || 1,
    logit_bias: profile.sampler.logitBias ?? null,
  } : {};

  // Conditionally add response_format for JSON responses
  // Temporarily disabled for debugging
  const formatOptions = {}; // profile.format === 'json' ? { response_format: { type: "json_object" as const } } : {};

  const baseOptions = {
    model,
    messages: trimmedMessages,
    ...samplerOptions,
    ...formatOptions,
  };

  try {
    if (options.stream) {
      console.log(`Making streaming LLM call to ${model} with format options:`, formatOptions);
      const stream = await client.chat.completions.create({
        ...baseOptions,
        stream: true,
      });

      return (async function* () {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      })();
    } else {
      console.log(`Making LLM call to ${model} with format options:`, formatOptions);
      const response = await client.chat.completions.create(baseOptions);
      return response.choices[0]?.message?.content || '';
    }
  } catch (error: any) {
    console.error('LLM API call failed:', {
      profile: profile.baseURL,
      model,
      error: error.message,
      status: error.status,
      response: error.response?.data
    });
    throw error;
  }
}