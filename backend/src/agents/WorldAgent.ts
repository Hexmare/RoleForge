import { BaseAgent, AgentContext } from './BaseAgent.js';
import { ChatMessage } from '../llm/client';

export class WorldAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('world', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('world', context);
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    const response = await this.callLLM(messages);
    return this.cleanResponse(response as string);
  }
}