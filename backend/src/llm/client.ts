import OpenAI from 'openai';
import axios from 'axios';
import { LLMProfile } from '../configManager';
import { countTokens } from '../utils/tokenCounter.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // 1 second
const BACKOFF_MULTIPLIER = 2; // Double each retry

// Retryable error codes (network, rate limit, temporary server errors)
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // HTTP status codes
  if (error.status && RETRYABLE_STATUS_CODES.includes(error.status)) {
    return true;
  }
  
  return false;
}

function calculateBackoff(retryCount: number): number {
  return INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, retryCount);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanPromptBackslashes(text: string): string {
  // Replace all instances of \\\ with \
  return text.replace(/\\\\\\/g, '\\');
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
  options: { stream?: boolean; fallbackProfiles?: LLMProfile[] } = {}
): Promise<string | AsyncIterable<string>> {
  let lastError: any = null;
  
  // Try main profile with retries, then fallback profiles
  const profilesToTry: LLMProfile[] = [profile];
  if (options.fallbackProfiles) {
    profilesToTry.push(...options.fallbackProfiles);
  }

  for (let profileIndex = 0; profileIndex < profilesToTry.length; profileIndex++) {
    const currentProfile = profilesToTry[profileIndex];
    
    for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
      try {
        console.log(`[LLM] Attempt ${retryCount + 1}/${MAX_RETRIES} on profile ${currentProfile.baseURL}`);
        
        const result = await attemptChatCompletion(currentProfile, messages, options);
        
        if (retryCount > 0) {
          console.log(`[LLM] Retry succeeded on attempt ${retryCount + 1}`);
        }
        
        return result;
      } catch (error: any) {
        lastError = error;
        
        if (!isRetryableError(error)) {
          console.error(`[LLM] Non-retryable error: ${error.message}`);
          break; // Don't retry on non-retryable errors
        }
        
        if (retryCount < MAX_RETRIES - 1) {
          const backoffMs = calculateBackoff(retryCount);
          console.warn(`[LLM] Retryable error, waiting ${backoffMs}ms before retry: ${error.message}`);
          await sleep(backoffMs);
        } else {
          console.warn(`[LLM] Max retries (${MAX_RETRIES}) reached on this profile`);
        }
      }
    }
    
    // If we have fallback profiles, log and continue to next
    if (profileIndex < profilesToTry.length - 1) {
      console.warn(`[LLM] Profile ${currentProfile.baseURL} failed, trying fallback profile`);
    }
  }
  
  // All profiles exhausted
  const errorMsg = `All LLM profiles failed. Last error: ${lastError?.message || 'Unknown error'}`;
  console.error(`[LLM] ${errorMsg}`);
  throw new Error(errorMsg);
}

async function attemptChatCompletion(
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
  
  // Clean up backslashes in all messages
  const cleanedMessages = trimmedMessages.map(msg => ({
    ...msg,
    content: cleanPromptBackslashes(msg.content)
  }));

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

  // Conditionally add response_format or other format options
  const formatOptions = profile.format ? profile.format : {};

  const baseOptions = {
    model,
    messages: cleanedMessages,
    ...samplerOptions,
    ...formatOptions,
  };

  try {
    if (options.stream) {
      console.log(`[LLM] Making streaming call to ${model} at ${profile.baseURL}`);
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
      console.log(`[LLM] Making non-streaming call to ${model} at ${profile.baseURL}`);
      const response = await client.chat.completions.create(baseOptions);
      return response.choices[0]?.message?.content || '';
    }
  } catch (error: any) {
    console.error('[LLM] API call failed:', {
      profile: profile.baseURL,
      model,
      error: error.message,
      status: error.status,
      code: error.code,
      response: error.response?.data
    });
    throw error;
  }
}