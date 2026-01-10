import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { chatCompletion, ChatMessage } from '../llm/client';
import { ConfigManager, LLMProfile } from '../configManager';
import { estimateWordsFromTokens } from '../utils/tokenCounter.js';

export interface AgentContext {
  userInput: string;
  history: string[];
  worldState: Record<string, any>;
  sceneSummary?: string;
  lore?: string[];
  directorGuidance?: string;
  visualPrompt?: string;
  visualOpportunity?: boolean;
  recentEvents?: string[];
  plotArc?: string;
  character?: any; // For CharacterAgent
  creationRequest?: string; // For CreatorAgent
  narration?: string; // For VisualAgent
  sceneElements?: string[]; // For VisualAgent
  visualStyle?: string; // For VisualAgent
  text?: string; // For TTSAgent
  voiceMap?: Record<string, string>; // For TTSAgent
  userPersona?: any; // For user persona
  activeCharacters?: string[]; // For DirectorAgent
  existingSummary?: string; // For SummarizeAgent
  maxSummaryTokens?: number; // For SummarizeAgent
  maxCompletionTokens?: number; // For response length limits
}

export abstract class BaseAgent {
  protected configManager: ConfigManager;
  protected env: nunjucks.Environment;
  protected agentName: string;

  constructor(agentName: string, configManager: ConfigManager, env: nunjucks.Environment) {
    this.agentName = agentName;
    this.configManager = configManager;
    this.env = env;
  }

  protected getProfile(): LLMProfile {
    // Get agent-specific profile or default
    const agentConfig = this.configManager.getConfig().agents?.[this.agentName];
    let profileName = agentConfig?.llmProfile || this.configManager.getConfig().defaultProfile;
    if (profileName === 'default') {
      profileName = this.configManager.getConfig().defaultProfile;
    }

    const baseProfile = this.configManager.getProfile(profileName);

    // Merge agent-specific overrides (sampler and format)
    const mergedProfile = { ...baseProfile };
    
    if (agentConfig?.sampler) {
      mergedProfile.sampler = {
        ...baseProfile.sampler,
        ...agentConfig.sampler
      };
    }
    
    if (agentConfig?.format) {
      mergedProfile.format = agentConfig.format;
    }

    return mergedProfile;
  }

  protected async callLLM(messages: ChatMessage[], stream: boolean = false): Promise<string | AsyncIterable<string>> {
    try {
      const profile = this.getProfile();
      return await chatCompletion(profile, messages, { stream });
    } catch (error: any) {
      console.error(`LLM call failed for agent ${this.agentName}:`, error);
      
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
    // First, try to split on --- (common separator for thinking)
    const parts = response.split('---');
    if (parts.length > 1) {
      return parts.slice(1).join('---').trim();
    }
    // Fallback: remove <thinking> tags
    return response.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
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

    return this.env.renderString(template, safeContext);
  }

  protected renderLLMTemplate(systemPrompt: string, userMessage: string, assistantMessage: string = ''): ChatMessage[] {
    const profile = this.getProfile();
    const templateName = profile.template || 'chatml'; // Default to 'chatml'
    const templatePath = path.join(dirname(fileURLToPath(import.meta.url)), '..', 'llm_templates', `${templateName}.njk`);
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

  abstract run(context: AgentContext): Promise<string>;
}