import { BaseAgent, AgentContext } from './BaseAgent.js';

export class DirectorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('director', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('director', context);
    const response = await this.callLLM(systemPrompt, context.userInput);
    return this.cleanResponse(response as string);
  }
}