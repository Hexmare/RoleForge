import { BaseAgent, AgentContext } from './BaseAgent.js';

export class DirectorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('director', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const messageContext = this.buildMessageContext(context);
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }
}