/**
 * Structured message context that separates content from formatting.
 * This allows us to build messages differently for OpenAI vs custom LLM backends.
 */
export interface MessageContext {
  /** Pre-system prompt for the agent (role definition, base instructions) */
  preSystemPrompt?: string;
  
  /** Vectorized memories retrieved for this context */
  memories?: string[];
  
  /** Relevant lore entries matched for this context */
  lore?: string[];
  
  /** Scene/conversation summary if summarization is enabled */
  summary?: string;
  
  /** Chat history (excluding current round messages) */
  chatHistory?: string[];
  
  /** Messages from the current round that precede this agent's turn */
  currentRoundMessages?: string[];
  
  /** Final system prompt for the agent (specific instructions for this turn) */
  finalSystemPrompt?: string;
  
  /** User input/prompt that triggered this agent */
  userInput?: string;
  
  /** JSON schema/specification if the agent expects JSON responses */
  jsonSpec?: {
    mode?: 'object' | 'schema';
    schema?: string | Record<string, any>;
    example?: Record<string, any>;
  };
  
  /** Additional metadata */
  metadata?: {
    agentName?: string;
    sceneId?: number;
    roundNumber?: number;
    characterName?: string;
    userPersonaName?: string;
  };
}

/**
 * Chat message format for LLM APIs
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
