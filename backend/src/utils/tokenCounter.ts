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



/**
 * Rough but very usable word count estimate from tokens
 * @param tokens - number of tokens (from encode().length)
 * @param wordsPerToken - adjust based on your typical content (0.75 is safe default)
 */
export function estimateWordsFromTokens(
  tokens: number,
  wordsPerToken: number = 0.75
): number {
  return Math.round(tokens * wordsPerToken);
}

/**
 * Estimate tokens needed for a given approximate word count
 * Useful for pre-checking before sending huge lorebooks/world info
 */
export function estimateTokensFromWords(
  words: number,
  tokensPerWord: number = 1.33   // ≈ 1 / 0.75
): number {
  return Math.ceil(words * tokensPerWord);
}

