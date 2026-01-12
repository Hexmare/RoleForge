import { BaseAgent, AgentContext } from './BaseAgent.js';

export class SummarizeAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('summarize', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('summarize', context);
    const response = await this.callLLM(systemPrompt, context.userInput);
    return this.cleanResponse(response as string);
  }
}