import { MessageContext, ChatMessage } from './types.js';

/**
 * Builds an OpenAI-compatible messages array from structured message context.
 * This directly constructs the message format without intermediate template rendering.
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
    systemParts.push('## MEMORIES\n' + context.memories.join('\n\n'));
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
    messages.push({
      role: 'system',
      content: systemParts.join('\n\n')
    });
  }
  
  // Add chat history with clear markers (previous rounds only, NOT including current round)
  if (context.chatHistory && context.chatHistory.length > 0) {
    let historyContent = '[CHAT HISTORY BEGIN]\nThese are the messages from previous rounds in the scene:\n\n';
    
    for (let i = 0; i < context.chatHistory.length; i++) {
      historyContent += context.chatHistory[i];
      if (i < context.chatHistory.length - 1) {
        historyContent += '\n\n';
      }
    }
    
    historyContent += '\n\n[CHAT HISTORY END]';
    
    messages.push({
      role: 'system',
      content: historyContent
    });
  }
  
  // Build current round interactions (user input + all character responses so far)
  let currentRoundContent = '[CURRENT ROUND INTERACTIONS]\nThe following messages have occurred in the current round.- do NOT repeat or quote them.\n\n';
  const roundParts: string[] = [];
  
  if (context.userInput) {
    roundParts.push(context.userInput);
  }
  
  if (context.currentRoundMessages && context.currentRoundMessages.length > 0) {
    for (let i = 0; i < context.currentRoundMessages.length; i++) {
      roundParts.push(context.currentRoundMessages[i]);
    }
  }
  
  currentRoundContent += roundParts.join('\n\n');
  
  // Add current round as the final user message
  if (roundParts.length > 0) {
    messages.push({
      role: 'user',
      content: currentRoundContent
    });
  }
  
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
