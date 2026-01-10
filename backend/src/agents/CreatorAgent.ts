import { BaseAgent, AgentContext } from './BaseAgent.js';

export class CreatorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('creator', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const mode = (context as any).mode || 'create';
    const systemPrompt = this.renderTemplate('creator', { ...context, mode });
    const messages = this.renderLLMTemplate(systemPrompt, (context as any).userInput || '');
    const response = await this.callLLM(messages);
    return this.cleanResponse(response as string);
  }
}