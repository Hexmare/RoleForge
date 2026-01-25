import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { chatCompletion, chatCompletionFromContext } from '../llm/client.js';
import { customLLMRequest } from '../llm/customClient.js';
import { ConfigManager, LLMProfile, Config } from '../configManager.js';
import { estimateWordsFromTokens } from '../utils/tokenCounter.js';
import { createLogger, NAMESPACES } from '../logging.js';
import { buildJsonReturnTemplate } from './context/jsonTemplates.js';
import { AgentContextEnvelope } from './context/types.js';
import { validateAgentJson } from './context/jsonValidation.js';
import { MessageContext, ChatMessage } from '../llm/types.js';
import { buildCustomTemplate } from '../llm/messageBuilder.js';

export interface AgentContext {
  userInput: string;
  history: string[];
  worldState: Record<string, any>;
  sceneSummary?: string;
  contextEnvelope?: AgentContextEnvelope;
  lore?: string[];
  formattedLore?: string;
  directorGuidance?: string;
  visualPrompt?: string;
  visualOpportunity?: boolean;
  recentEvents?: string[];
  plotArc?: string;
  character?: any; // For CharacterAgent
  characterState?: any; // For CharacterAgent - current state of the character
  characterDirective?: string; // For CharacterAgent - director-provided guidance for this turn
  entryGuidance?: string; // For CharacterAgent - guidance when entering this round
  exitGuidance?: string; // For CharacterAgent - guidance when exiting this round
  roundFlags?: Record<string, any>; // For CharacterAgent - per-round flags (entered/exited/hasActed)
  creationRequest?: string; // For CreatorAgent
  mode?: string; // For CreatorAgent - 'create', 'update', 'field'
  narrationMode?: string; // For NarratorAgent - 'default' or 'scene-picture'
  narration?: string; // For VisualAgent
  sceneElements?: string[]; // For VisualAgent
  visualStyle?: string; // For VisualAgent
  text?: string; // For TTSAgent
  voiceMap?: Record<string, string>; // For TTSAgent
  userPersona?: any; // For user persona
  userPersonaState?: any; // For user persona - current state of the user persona
  activeCharacters?: any[]; // For DirectorAgent (strings) or NarratorAgent (objects)
  existingSummary?: string; // For SummarizeAgent
  maxSummaryTokens?: number; // For SummarizeAgent
  maxCompletionTokens?: number; // For response length limits
  previousWorldState?: Record<string, any>; // For WorldAgent - previous state
  characterStates?: Record<string, any>; // For WorldAgent - all character states
  scene?: any; // For WorldAgent - current scene info
  trackers?: any; // For WorldAgent - current trackers (stats, objectives, relationships)
  sceneId?: number; // For VectorizationAgent - scene identifier
  roundNumber?: number; // For VectorizationAgent - round number
  messages?: any[]; // For VectorizationAgent - round messages to vectorize
  vectorMemories?: string; // For Phase 3 - formatted memories from vector store for prompt injection
  vectorMemoriesRaw?: any[]; // Raw vector memories payload (pre-formatting)
}

export abstract class BaseAgent {
  protected configManager: ConfigManager;
  protected env: nunjucks.Environment;
  protected agentName: string;
  private readonly baseAgentLog = createLogger(NAMESPACES.agents.base);

  constructor(agentName: string, configManager: ConfigManager, env: nunjucks.Environment) {
    this.agentName = agentName;
    this.configManager = configManager;
    this.env = env;
    try {
      if (this.env && typeof (this.env as any).addFilter === 'function') {
        (this.env as any).addFilter('json', (obj: any) => JSON.stringify(obj, null, 2));
      }
      if (this.env && typeof (this.env as any).addGlobal === 'function') {
        (this.env as any).addGlobal('JSON', JSON);
      }
    } catch (e) {
      // In some test environments a mock env may not support filters/globals; skip silently.
    }
  }

  protected getProfile(): LLMProfile {
    // Reload config to ensure latest changes are applied
    this.configManager.reload();

    // Get agent-specific profile or default
    const agentConfig = this.configManager.getConfig().agents?.[this.agentName];
    let profileName = agentConfig?.llmProfile || this.configManager.getConfig().defaultProfile;
    if (profileName === 'default') {
      profileName = this.configManager.getConfig().defaultProfile;
    }

    const baseProfile = this.configManager.getProfile(profileName) as any;

    // Defensive merge: start with base, then apply only explicit overrides
    const mergedProfile: any = { ...baseProfile };

    // Ensure sampler object exists before merging
    mergedProfile.sampler = {
      ...(baseProfile?.sampler || {}),
      ...(agentConfig?.sampler || {})
    };

    // Preserve type from base unless agent explicitly provides it
    mergedProfile.type = (agentConfig as any)?.type ?? baseProfile?.type;

    // Determine format: explicit agent override -> agent returnsJson flag -> sampler.forceJson -> base profile
    if (agentConfig?.format) {
      mergedProfile.format = agentConfig.format;
    } else if (agentConfig?.expectsJson || agentConfig?.jsonMode || agentConfig?.returnsJson) {
      mergedProfile.format = 'json';
    } else if (mergedProfile.sampler?.forceJson) {
      mergedProfile.format = 'json';
    } else {
      mergedProfile.format = baseProfile?.format;
    }

    // Apply other optional overrides only when provided
    if (agentConfig?.apiKey !== undefined) mergedProfile.apiKey = agentConfig.apiKey;
    if (agentConfig?.baseURL !== undefined) mergedProfile.baseURL = agentConfig.baseURL;
    if (agentConfig?.model !== undefined) mergedProfile.model = agentConfig.model;
    if (agentConfig?.template !== undefined) mergedProfile.template = agentConfig.template;

    return mergedProfile as LLMProfile;
  }

  /**
   * Helper method to build MessageContext from AgentContext.
   * Converts the old context structure to the new MessageContext format.
   */
  protected buildMessageContext(agentContext: AgentContext, systemPrompt?: string): MessageContext {
    const envelope = agentContext.contextEnvelope;
    
    return {
      preSystemPrompt: systemPrompt || this.renderTemplate(this.agentName, agentContext),
      memories: envelope ? this.formatMemories(envelope.memories) : undefined,
      lore: envelope?.lore || agentContext.lore,
      summary: envelope?.summarizedHistory?.[0] || agentContext.sceneSummary,
      chatHistory: envelope?.history || agentContext.history,
      currentRoundMessages: envelope?.lastRoundMessages,
      userInput: agentContext.userInput,
      metadata: {
        agentName: this.agentName,
        sceneId: envelope?.sceneId,
        roundNumber: envelope?.roundNumber
      }
    };
  }

  /**
   * Format memories from envelope structure into string array.
   * Extracts clean text only, wraps each in brackets, adds begin/end markers.
   */
  private formatMemories(memories?: Record<string, any[]>): string[] | undefined {
    if (!memories) return undefined;
    
    const formatted: string[] = [];
    
    for (const [key, entries] of Object.entries(memories)) {
      if (key === '__loreOverride') continue;
      if (entries && entries.length > 0) {
        for (const entry of entries) {
          // Extract clean text from memory object
          let cleanText = '';
          
          if (typeof entry === 'string') {
            cleanText = entry;
          } else if (entry && typeof entry === 'object') {
            // Try to extract text field, falling back to metadata.text
            cleanText = entry.text || entry.metadata?.text || entry.content || JSON.stringify(entry);
          }
          
          if (cleanText) {
            // Wrap each memory in brackets
            formatted.push(`[${cleanText}]`);
          }
        }
      }
    }
    
    return formatted.length > 0 ? formatted : undefined;
  }

  /**
   * New method: Call LLM with structured MessageContext.
   * This is the preferred method going forward - it separates content from formatting.
   */
  protected async callLLMWithContext(context: MessageContext): Promise<string> {
    try {
      const profile = this.getProfile();
      const fullConfig = this.configManager.getConfig();
      const agentConfig = fullConfig.agents?.[this.agentName];
      const features = fullConfig.features || {};
      const maxValidationRetries = Math.max(0, features.jsonValidationMaxRetries ?? 1);

      // Add JSON spec from agent config if not already in context
      if (!context.jsonSpec && agentConfig && (agentConfig.expectsJson || agentConfig.jsonMode)) {
        context.jsonSpec = {
          mode: agentConfig.jsonMode,
          schema: agentConfig.jsonSchema,
          example: agentConfig.jsonExample
        };
      }

      // Add metadata if not present
      if (!context.metadata) {
        context.metadata = { agentName: this.agentName };
      }

      let attempt = 0;
      let lastValidation: { output: string; valid: boolean; errors?: string[] } | null = null;
      let lastRaw = '';

      while (attempt <= maxValidationRetries) {
        // On retry, add error info to the context WITHOUT including the failed response
        const contextForAttempt = attempt === 0
          ? context
          : {
              ...context,
              userInput: context.userInput + `\n\n[VALIDATION RETRY]\nPrevious response had invalid JSON (${lastValidation?.errors?.join('; ') || 'invalid format'}). Return valid JSON only, matching the expected schema/object. No commentary.`
            };

        let raw = '';
        if (profile.type === 'custom') {
          // Use custom template rendering
          const templateName = profile.template || 'chatml';
          raw = await customLLMRequest(
            profile,
            buildCustomTemplate(contextForAttempt, templateName, this.env),
            {}
          );
        } else {
          // Use OpenAI message builder
          const result = await chatCompletionFromContext(profile, contextForAttempt, { stream: false });
          raw = result as string;
        }

        lastRaw = raw;
        const validation = this.validateAndMaybeCoerceJson(raw, agentConfig, features);
        lastValidation = validation;

        if (validation.valid) {
          return validation.output;
        }

        attempt += 1;
      }

      this.baseAgentLog('[JSON VALIDATION] agent=%s failed after %d attempts errors=%o', this.agentName, maxValidationRetries + 1, lastValidation?.errors);

      if (agentConfig && (agentConfig.expectsJson || agentConfig.jsonMode || agentConfig.returnsJson)) {
        return JSON.stringify({ error: 'failed_json_validation', errors: lastValidation?.errors || ['unknown_error'] });
      }

      return lastRaw;
    } catch (error: any) {
      this.baseAgentLog('[LLM] Call failed for agent %s: %o', this.agentName, error);
      
      // Provide a fallback response based on agent type
      switch (this.agentName) {
        case 'character':
          return "I apologize, but I'm having trouble responding right now. Could you try rephrasing your message?";
        case 'narrator':
          return "The scene remains as it was. The environment is quiet and unchanged.";
        case 'director':
          return '{"guidance": "Continue the conversation naturally.", "characters": []}';
        case 'world':
          return '{"updates": []}';
        case 'summarize':
          return "Unable to generate summary at this time.";
        case 'visual':
          return "Unable to generate visual content at this time.";
        case 'creator':
          return "Unable to create content at this time.";
        default:
          return "I apologize, but I'm experiencing technical difficulties.";
      }
    }
  }

  protected async callLLM(systemPrompt: string, userMessage: string, assistantMessage: string = ''): Promise<string> {
    try {
      const profile = this.getProfile();
      const fullConfig = this.configManager.getConfig();
      const agentConfig = fullConfig.agents?.[this.agentName];
      const features = fullConfig.features || {};
      const jsonTemplate = buildJsonReturnTemplate(agentConfig);
      const maxValidationRetries = Math.max(0, features.jsonValidationMaxRetries ?? 1);

      let promptToSend = systemPrompt;
      if (jsonTemplate) {
        const parts = [systemPrompt];
        parts.push('\n[OUTPUT FORMAT]\n');
        parts.push(jsonTemplate.instructions);
        if (jsonTemplate.schema) {
          parts.push('\nSchema:\n');
          parts.push(typeof jsonTemplate.schema === 'string' ? jsonTemplate.schema : JSON.stringify(jsonTemplate.schema, null, 2));
        }
        if (jsonTemplate.example) {
          parts.push('\nExample:\n');
          parts.push(JSON.stringify(jsonTemplate.example, null, 2));
        }
        promptToSend = parts.join('');
      }
      
      let attempt = 0;
      let lastValidation: { output: string; valid: boolean; errors?: string[] } | null = null;
      let lastRaw = '';

      while (attempt <= maxValidationRetries) {
        const promptForAttempt = attempt === 0
          ? promptToSend
          : this.buildValidationRetryPrompt(promptToSend, lastValidation?.errors, lastRaw);

        let raw = '';
        if (profile.type === 'custom') {
          raw = await this.callCustomLLM(promptForAttempt, userMessage, assistantMessage);
        } else {
          const messages = this.renderLLMTemplate(promptForAttempt, userMessage, assistantMessage);
          const result = await chatCompletion(profile, messages, { stream: false });
          raw = result as string;
        }

        lastRaw = raw;
        const validation = this.validateAndMaybeCoerceJson(raw, agentConfig, features);
        lastValidation = validation;

        if (validation.valid) {
          return validation.output;
        }

        attempt += 1;
      }

      this.baseAgentLog('[JSON VALIDATION] agent=%s failed after %d attempts errors=%o', this.agentName, maxValidationRetries + 1, lastValidation?.errors);

      if (agentConfig && (agentConfig.expectsJson || agentConfig.jsonMode || agentConfig.returnsJson)) {
        return JSON.stringify({ error: 'failed_json_validation', errors: lastValidation?.errors || ['unknown_error'] });
      }

      return lastRaw;
    } catch (error: any) {
      this.baseAgentLog('[LLM] Call failed for agent %s: %o', this.agentName, error);
      
      // Provide a fallback response based on agent type
      switch (this.agentName) {
        case 'character':
          return "I apologize, but I'm having trouble responding right now. Could you try rephrasing your message?";
        case 'narrator':
          return "The scene remains as it was. The environment is quiet and unchanged.";
        case 'director':
          return '{"guidance": "Continue the conversation naturally.", "characters": []}';
        case 'world':
          return '{"updates": []}';
        case 'summarize':
          return "Unable to generate summary at this time.";
        case 'visual':
          return "Unable to generate visual content at this time.";
        case 'creator':
          return "Unable to create content at this time.";
        default:
          return "I apologize, but I'm experiencing technical difficulties.";
      }
    }
  }

  private validateAndMaybeCoerceJson(raw: string, agentConfig: any, features?: Config['features']): { output: string; valid: boolean; errors?: string[] } {
    const shouldValidate = (features?.jsonValidationEnabled ?? true) !== false;
    const expectsJson = agentConfig && (agentConfig.expectsJson || agentConfig.jsonMode || agentConfig.returnsJson);

    if (!shouldValidate || !expectsJson) {
      return { output: raw, valid: true };
    }

    const result = validateAgentJson(agentConfig, raw);
    const payloadForLog = result.parsed !== null && result.parsed !== undefined ? JSON.stringify(result.parsed) : raw;
    if (features?.jsonValidationDevLog) {
      this.baseAgentLog(
        '[JSON VALIDATION] agent=%s valid=%s repaired=%s errors=%o payload=%s',
        this.agentName,
        result.valid,
        result.repaired,
        result.errors,
        this.truncateForLog(payloadForLog)
      );
    }

    if (result.valid && result.parsed !== null && result.parsed !== undefined) {
      return { output: JSON.stringify(result.parsed), valid: true };
    }

    return { output: raw, valid: false, errors: result.errors };
  }

  private buildValidationRetryPrompt(basePrompt: string, errors: string[] | undefined, raw: string): string {
    const errorText = errors && errors.length > 0 ? errors.join('; ') : 'invalid JSON output';
    return `${basePrompt}\n\n[VALIDATION RETRY]\nPrevious response had invalid JSON (${errorText}). Return valid JSON only, matching the expected schema/object. No commentary.`;
  }

  private truncateForLog(value: string): string {
    if (!value) return '';
    const limit = 500;
    return value.length <= limit ? value : `${value.slice(0, limit)}...`;
  }

  protected cleanResponse(response: string): string {
    let cleaned = response;
    
    // Remove markdown code blocks (e.g., ```json ... ```)
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    
    // First, try to split on --- (common separator for thinking)
    const parts = cleaned.split('---');
    if (parts.length > 1) {
      cleaned = parts.slice(1).join('---').trim();
    }
    
    // Fallback: remove <thinking> tags
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    
    return cleaned;
  }

  /**
   * Safely parse JSON from LLM response, handling:
   * - Code fences (```json ... ```)
   * - Wrapper objects like {"result": "..."}
   * - Nested JSON strings
   * @param response Raw LLM response
   * @returns Parsed JSON object or original string if parsing fails
   */
  protected parseJsonSafely(response: string): any {
    let cleaned = this.cleanResponse(response);
    
    try {
      // First attempt: direct parse
      const parsed = JSON.parse(cleaned);
      
      // Check if it's a wrapper object with a single "result" key
      if (parsed && typeof parsed === 'object' && 'result' in parsed && Object.keys(parsed).length === 1) {
        // Try to parse the result value if it's a string
        if (typeof parsed.result === 'string') {
          try {
            return JSON.parse(parsed.result);
          } catch {
            // If result is not valid JSON, return it as-is
            return parsed.result;
          }
        }
        return parsed.result;
      }
      
      return parsed;
    } catch (error) {
      // If direct parse fails, return the cleaned string
      return cleaned;
    }
  }

  protected renderTemplate(templateName: string, context: AgentContext): string {
    const templatePath = path.join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', `${templateName}.njk`);
    const template = fs.readFileSync(templatePath, 'utf-8');
    // Sanitize certain context fields (character descriptions, userPersona) to escape double-quotes and backslashes
    const escapeForTemplate = (v: any) => {
      if (typeof v !== 'string') return v;
      return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    };
    const safeContext: any = { ...context } as any;
    if (context.character && typeof context.character === 'object') {
      safeContext.character = { ...context.character };
      if ('description' in safeContext.character) safeContext.character.description = escapeForTemplate(safeContext.character.description);
      if ('personality' in safeContext.character) safeContext.character.personality = escapeForTemplate(safeContext.character.personality);
      if ('name' in safeContext.character) safeContext.character.name = escapeForTemplate(safeContext.character.name);
    }
    if (context.userPersona && typeof context.userPersona === 'object') {
      safeContext.userPersona = { ...context.userPersona };
      if ('description' in safeContext.userPersona) safeContext.userPersona.description = escapeForTemplate(safeContext.userPersona.description);
      if ('name' in safeContext.userPersona) safeContext.userPersona.name = escapeForTemplate(safeContext.userPersona.name);
    }

    // Add utility functions to template context
    safeContext.estimateWordsFromTokens = estimateWordsFromTokens;

    const result = this.env.renderString(template, safeContext);
    const preview = result.substring(0, 500) + (result.length > 500 ? '...' : '');
    this.baseAgentLog('Rendered template for %s: %s', templateName, preview);
    return result;
  }

  protected renderLLMTemplate(systemPrompt: string, userMessage: string, assistantMessage: string = ''): ChatMessage[] {
    const profile = this.getProfile();
    let templateName = profile.template || 'chatml'; // Default to 'chatml'
    const templatesDir = path.join(dirname(fileURLToPath(import.meta.url)), '..', 'llm_templates');
    let templatePath = path.join(templatesDir, `${templateName}.njk`);
    
    // Check if template file exists; fallback to chatml if not
    if (!fs.existsSync(templatePath)) {
      this.baseAgentLog('WARN: Template file not found: %s. Falling back to chatml.njk', templatePath);
      templateName = 'chatml';
      templatePath = path.join(templatesDir, `${templateName}.njk`);
      
      // Final safety check: ensure chatml exists
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Critical: Default template chatml.njk not found at ${templatePath}`);
      }
    }
    
    const template = fs.readFileSync(templatePath, 'utf-8');
    const rendered = this.env.renderString(template, { system_prompt: systemPrompt, user_message: userMessage, assistant_message: assistantMessage });

    // Parse the rendered template into ChatMessage[]
    const messages: ChatMessage[] = [];
    const parts = rendered.split('<|im_start|>');
    for (const part of parts) {
      if (part.trim()) {
        const lines = part.split('\n');
        const roleLine = lines[0].trim();
        const content = lines.slice(1).join('\n').replace('<|im_end|>', '').trim();
        if ((roleLine === 'system' || roleLine === 'user' || roleLine === 'assistant') && content !== '') {
          messages.push({ role: roleLine, content });
        }
      }
    }
    return messages;
  }

  /**
   * Render raw LLM template for custom clients (non-OpenAI).
   * Returns the raw rendered template string without parsing.
   */
  protected renderRawLLMTemplate(systemPrompt: string, userMessage: string, assistantMessage: string = ''): string {
    const profile = this.getProfile();
    const templateName = profile.template || 'chatml';
    const templatesDir = path.join(dirname(fileURLToPath(import.meta.url)), '..', 'llm_templates');
    const templatePath = path.join(templatesDir, `${templateName}.njk`);
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    
    const template = fs.readFileSync(templatePath, 'utf-8');
    
    // Support both simple (chatml) and complex (magidoniasmall) templates
    let templateVars: any = {
      system_prompt: systemPrompt,
      user_message: userMessage,
      assistant_message: assistantMessage,
    };
    
    // For templates that support message arrays (like magidoniasmall)
    if (templateName === 'magidoniasmall' || templateName === 'magidonia') {
      templateVars.messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
        ...(assistantMessage ? [{ role: 'assistant', content: assistantMessage }] : []),
      ];
      templateVars.system = systemPrompt;
      templateVars.tools = null; // No tools in raw LLM rendering
      templateVars.isThinkSet = false; // Check if system prompt contains /think
      templateVars.think = systemPrompt.includes('/think');
    }
    
    const rendered = this.env.renderString(template, templateVars);
    
    return rendered;
  }

  /**
   * Call custom LLM (non-OpenAI) with rendered prompt.
   * Used by agents that use custom profile types.
   */
  protected async callCustomLLM(systemPrompt: string, userMessage: string, assistantMessage: string = ''): Promise<string> {
    try {
      const profile = this.getProfile();
      const renderedPrompt = this.renderRawLLMTemplate(systemPrompt, userMessage, assistantMessage);
      
      this.baseAgentLog('[Agent %s] Calling custom LLM with profile %s template', this.agentName, profile.template);
      
      return await customLLMRequest(profile, renderedPrompt);
    } catch (error: any) {
      this.baseAgentLog('[Custom LLM] Call failed for agent %s: %o', this.agentName, error);
      
      // Provide a fallback response based on agent type
      switch (this.agentName) {
        case 'character':
          return "I apologize, but I'm having trouble responding right now. Could you try rephrasing your message?";
        case 'narrator':
          return "The scene remains as it was. The environment is quiet and unchanged.";
        case 'director':
          return '{"guidance": "Continue the conversation naturally.", "characters": []}';
        case 'world':
          return '{"updates": []}';
        case 'summarize':
          return "Unable to generate summary at this time.";
        case 'visual':
          return "Unable to generate visual content at this time.";
        case 'creator':
          return "Unable to create content at this time.";
        default:
          return "I apologize, but I'm experiencing technical difficulties.";
      }
    }
  }

  abstract run(context: AgentContext): Promise<string>;
}