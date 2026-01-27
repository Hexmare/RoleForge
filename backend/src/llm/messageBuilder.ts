import { MessageContext, ChatMessage } from './types.js';

/**
 * Parse a history message to extract speaker and content.
 * Expected formats: "SpeakerName: message" or just "message"
 */
function parseHistoryMessage(message: string): { speaker: string | null; content: string } {
  const colonIndex = message.indexOf(':');
  if (colonIndex > 0 && colonIndex < 50) { // Reasonable speaker name length
    const speaker = message.substring(0, colonIndex).trim();
    const content = message.substring(colonIndex + 1).trim();
    return { speaker, content };
  }
  return { speaker: null, content: message };
}

/**
 * Determine if a speaker should be mapped to 'user' role.
 * User personas, player names, etc. should be 'user'.
 */
function isUserSpeaker(speaker: string, context: MessageContext): boolean {
  if (!speaker) return false;
  const lowerSpeaker = speaker.toLowerCase();
  
  // Check against common user identifiers
  if (lowerSpeaker === 'user' || lowerSpeaker === 'player' || lowerSpeaker === 'you') {
    return true;
  }
  
  // Check if matches the user persona name from metadata
  if (context.metadata?.userPersonaName) {
    const lowerUserName = context.metadata.userPersonaName.toLowerCase();
    if (lowerSpeaker === lowerUserName) {
      return true;
    }
  }
  
  return false;
}

/**
 * Builds an OpenAI-compatible messages array from structured message context.
 * This directly constructs the message format without intermediate template rendering.
 * 
 * CRITICAL: Chat history is converted to proper user/assistant message pairs,
 * NOT dumped into a second system message. This prevents character confusion.
 */
export function buildOpenAIMessages(context: MessageContext): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const systemParts: string[] = [];
  
  // Build system message from all system-level components
  if (context.preSystemPrompt) {
    systemParts.push(context.preSystemPrompt);
  }
  
  if (context.summary) {
    systemParts.push('## SCENE SUMMARY\n' + context.summary);
  }
  
  if (context.lore && context.lore.length > 0) {
    systemParts.push('## LORE\n' + context.lore.join('\n\n'));
  }
  
  if (context.memories && context.memories.length > 0) {
    // Each memory is already wrapped in brackets by formatMemories
    // Join with newlines for readability
    systemParts.push('[Memories begin]\n' + context.memories.join('\n') + '\n[Memories end]');
  }
  
  if (context.finalSystemPrompt) {
    systemParts.push(context.finalSystemPrompt);
  }
  
  // Add JSON specification if needed
  if (context.jsonSpec) {
    if (context.jsonSpec.mode === 'schema' && context.jsonSpec.schema) {
      const schemaStr = typeof context.jsonSpec.schema === 'string' 
        ? context.jsonSpec.schema 
        : JSON.stringify(context.jsonSpec.schema, null, 2);
      systemParts.push('## OUTPUT FORMAT\nRespond with JSON matching this schema:\n```json\n' + schemaStr + '\n```');
    } else if (context.jsonSpec.mode === 'object' && context.jsonSpec.example) {
      systemParts.push('## OUTPUT FORMAT\nRespond with JSON matching this structure:\n```json\n' + JSON.stringify(context.jsonSpec.example, null, 2) + '\n```');
    }
  }
  
  // Create system message
  if (systemParts.length > 0) {
    const systemContent = systemParts.join('\n\n');
    console.log('[MESSAGE_BUILDER] System message length:', systemContent.length);
    console.log('[MESSAGE_BUILDER] System message parts:', systemParts.map(p => `${p.substring(0, 50)}... (${p.length} chars)`));
    messages.push({
      role: 'system',
      content: systemContent
    });
  }
  
  // CRITICAL INSIGHT: OpenAI's "assistant" role means "the AI you're talking to" - there's only ONE assistant.
  // In multi-character scenarios, putting different characters as "assistant" teaches the model to blend them.
  // SOLUTION: Put ALL conversation history in system context with clear speaker labels.
  // Only use user/assistant for the actual conversation flow with the LLM.
  
  const currentCharName = context.metadata?.characterName;
  const userPersonaName = context.metadata?.userPersonaName;
  
  // Build conversation history as structured system context (deduped, with speaker labels)
  if (context.chatHistory && context.chatHistory.length > 0) {
    console.log('[MESSAGE_BUILDER] Adding', context.chatHistory.length, 'history messages to system context');

    const seenHistory = new Set<string>();
    let historyContent = '## CONVERSATION HISTORY\n';

    for (const historyMsg of context.chatHistory) {
      const trimmed = (historyMsg || '').trim();
      if (!trimmed) continue;

      // Ensure a speaker prefix exists
      const colonIndex = trimmed.indexOf(':');
      const withSpeaker = colonIndex > 0
        ? trimmed
        : `${currentCharName || 'Speaker'}: ${trimmed}`;

      if (seenHistory.has(withSpeaker)) continue;
      seenHistory.add(withSpeaker);
      historyContent += withSpeaker + '\n\n';
    }

    if (seenHistory.size > 0) {
      messages.push({
        role: 'system',
        content: historyContent.trim()
      });
    }
  }
  
  // Build current round interactions as the final user message
  let currentRoundContent = `## CURRENT TURN\nYou are ${currentCharName}. Respond as ${currentCharName} based on the following:\n\n`;
  const roundParts: string[] = [];

  // Helper to ensure speaker labels are present and deduplicate messages
  const normalizeRoundMessages = (messages: string[]): string[] => {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const msg of messages) {
      const trimmed = msg.trim();
      if (!trimmed) continue;

      // Drop system/meta noise that leaks into rounds
      if (trimmed.includes('[System: Continue scene')) continue;
      if (trimmed.includes('PrevSpeaker')) continue;
      if (trimmed.startsWith('undefined:')) continue;

      // Ensure a speaker prefix exists
      const colonIndex = trimmed.indexOf(':');
      const withSpeaker = colonIndex > 0
        ? trimmed
        : `${currentCharName || 'Speaker'}: ${trimmed}`;

      // Dedup by full line
      if (!seen.has(withSpeaker)) {
        seen.add(withSpeaker);
        normalized.push(withSpeaker);
      }
    }
    return normalized;
  };
  
  if (context.userInput) {
    const trimmedInput = context.userInput.trim();
    // Skip injected continue-scene blobs to avoid repetition
    const isContinueSceneBlob = trimmedInput.startsWith('[System: Continue scene') || trimmedInput.includes('Previous character messages:');
    if (!isContinueSceneBlob) {
      roundParts.push(`${userPersonaName || 'User'}: ${trimmedInput}`);
    }
  }
  
  if (context.currentRoundMessages && context.currentRoundMessages.length > 0) {
    const normalized = normalizeRoundMessages(context.currentRoundMessages);
    for (const msg of normalized) {
      roundParts.push(msg);
    }
  }
  
  if (roundParts.length > 0) {
    currentRoundContent += roundParts.join('\n\n');
    // Explicit anti-parroting rule for current turn
    currentRoundContent += '\n\nRULE: Do not repeat or paraphrase the wording above. Avoid reusing openings, phrases, or topics already said. Add a new angle or detail that has not been mentioned.';
    
    messages.push({
      role: 'user',
      content: currentRoundContent
    });
  }
  
  console.log('[MESSAGE_BUILDER] Built', messages.length, 'messages:', 
    messages.filter(m => m.role === 'system').length, 'system,',
    messages.filter(m => m.role === 'user').length, 'user');
  
  return messages;
}

/**
 * Renders a custom LLM template with the message context.
 * This maintains support for custom template formats (Mistral, ChatML, etc.)
 */
export function buildCustomTemplate(context: MessageContext, templateName: string, nunjucksEnv: any): string {
  // For custom templates, we pass the entire context structure
  // The template can access all fields and format them as needed
  const templateData = {
    preSystemPrompt: context.preSystemPrompt || '',
    memories: context.memories || [],
    lore: context.lore || [],
    summary: context.summary || '',
    chatHistory: context.chatHistory || [],
    currentRoundMessages: context.currentRoundMessages || [],
    finalSystemPrompt: context.finalSystemPrompt || '',
    userInput: context.userInput || '',
    jsonSpec: context.jsonSpec,
    metadata: context.metadata || {}
  };
  
  return nunjucksEnv.render(`llm_templates/${templateName}.njk`, templateData);
}
