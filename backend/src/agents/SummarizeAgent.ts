import { BaseAgent, AgentContext } from './BaseAgent.js';

export class SummarizeAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('summarize', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const messageContext = this.buildMessageContext(context);
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }
}