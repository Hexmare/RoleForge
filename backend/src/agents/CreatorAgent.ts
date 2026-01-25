import { BaseAgent, AgentContext } from './BaseAgent.js';

export class CreatorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('creator', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const mode = (context as any).mode || 'create';
    const systemPrompt = this.renderTemplate('creator', { ...context, mode });
    const messageContext = this.buildMessageContext(context, systemPrompt);
    messageContext.userInput = (context as any).userInput || '';
    const response = await this.callLLMWithContext(messageContext);
    
    // Use parseJsonSafely to handle code fences and wrapper objects
    const parsed = this.parseJsonSafely(response as string);
    
    // If parsed is an object, return it as JSON string; otherwise return as-is
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify(parsed);
    }
    return parsed;
  }
}