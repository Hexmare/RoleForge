import axios from 'axios';
import { LLMProfile } from '../configManager';

export interface CustomClientOptions {
  stream?: boolean;
  timeout?: number;
}

/**
 * Custom LLM client using axios for non-OpenAI compatible endpoints.
 * Sends raw rendered prompts directly to the LLM backend.
 */
export async function customLLMRequest(
  profile: LLMProfile,
  renderedPrompt: string,
  options: CustomClientOptions = {}
): Promise<string> {
  const { timeout = 120000 } = options;

  try {
    console.log(`[Custom LLM] Posting to ${profile.baseURL} with model ${profile.model}`);

    // Construct request body based on common LLM API patterns
    const requestBody = {
      prompt: renderedPrompt,
      model: profile.model,
      max_tokens: profile.sampler?.max_completion_tokens || 512,
      temperature: profile.sampler?.temperature || 0.7,
      top_p: profile.sampler?.topP || 0.9,
      ...(profile.sampler?.frequencyPenalty !== undefined && { frequency_penalty: profile.sampler.frequencyPenalty }),
      ...(profile.sampler?.presencePenalty !== undefined && { presence_penalty: profile.sampler.presencePenalty }),
      ...(profile.sampler?.stop && profile.sampler.stop.length > 0 && { stop: profile.sampler.stop }),
    };

    const response = await axios.post(`${profile.baseURL}/completions`, requestBody, {
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(profile.apiKey && { Authorization: `Bearer ${profile.apiKey}` }),
      },
    });

    // Handle various response formats
    if (response.data.choices && response.data.choices.length > 0) {
      const choice = response.data.choices[0];
      // Support both 'text' (completions API) and 'message.content' (chat format)
      return choice.text || choice.message?.content || '';
    }

    if (response.data.result) {
      return response.data.result;
    }

    console.warn('[Custom LLM] Unexpected response format:', response.data);
    return '';
  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
    console.error(`[Custom LLM] Request failed: ${errorMessage}`);
    throw error;
  }
}
