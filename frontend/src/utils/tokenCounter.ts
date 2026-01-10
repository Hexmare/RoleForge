import { encode } from 'gpt-tokenizer';

/**
 * Accurately count tokens using GPT tokenizer
 * Falls back to character-based estimation if tokenization fails
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  try {
    const tokens = encode(text);
    return tokens.length;
  } catch (error) {
    console.warn('Tokenization failed, using fallback estimation:', error);
    // Fallback: ~4 characters per token (rough approximation)
    return Math.max(1, Math.round(text.length / 4));
  }
}

/**
 * Estimate tokens for multiple texts
 */
export function countTokensBatch(texts: string[]): number {
  return texts.reduce((total, text) => total + countTokens(text), 0);
}