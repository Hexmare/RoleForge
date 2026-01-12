import { BaseAgent, AgentContext } from './BaseAgent.js';

export class WorldAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('world', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('world', context);
    const response = await this.callLLM(systemPrompt, '');
    return this.cleanResponse(response as string);
  }
}