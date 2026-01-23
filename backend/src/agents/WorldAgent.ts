import { BaseAgent, AgentContext } from './BaseAgent.js';

export class WorldAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('world', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('world', context);
    const messageContext = this.buildMessageContext(context, systemPrompt);
    messageContext.userInput = ''; // WorldAgent doesn't use user input
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }
}