import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { chatCompletion, ChatMessage } from '../llm/client';
import { customLLMRequest } from '../llm/customClient';
import { ConfigManager, LLMProfile } from '../configManager';
import { estimateWordsFromTokens } from '../utils/tokenCounter.js';
import { createLogger, NAMESPACES } from '../logging';

export interface AgentContext {
  userInput: string;
  history: string[];
  worldState: Record<string, any>;
  sceneSummary?: string;
  lore?: string[];
  formattedLore?: string;
  directorGuidance?: string;
  visualPrompt?: string;
  visualOpportunity?: boolean;
  recentEvents?: string[];
  plotArc?: string;
  character?: any; // For CharacterAgent
  characterState?: any; // For CharacterAgent - current state of the character
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
    } else if (agentConfig?.returnsJson) {
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

  protected async callLLM(systemPrompt: string, userMessage: string, assistantMessage: string = ''): Promise<string> {
    try {
      const profile = this.getProfile();
      
      // Route based on profile type
      if (profile.type === 'custom') {
        // For custom profiles, use raw template rendering + customLLMRequest
        return await this.callCustomLLM(systemPrompt, userMessage, assistantMessage);
      }
      
      // For openai profiles, render to ChatMessage[] and use OpenAI SDK
      const messages = this.renderLLMTemplate(systemPrompt, userMessage, assistantMessage);
      const result = await chatCompletion(profile, messages, { stream: false });
      // chatCompletion with stream: false returns a string, not an AsyncIterable
      return result as string;
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