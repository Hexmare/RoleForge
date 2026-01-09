import { BaseAgent, AgentContext } from './BaseAgent.js';
import { ChatMessage } from '../llm/client';

export class DirectorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('director', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('director', context);
    const messages = this.renderLLMTemplate(systemPrompt, context.userInput);
    const response = await this.callLLM(messages);
    return this.cleanResponse(response as string);
  }
}