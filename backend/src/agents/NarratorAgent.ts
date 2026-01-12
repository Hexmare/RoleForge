import { BaseAgent, AgentContext } from './BaseAgent.js';

export class NarratorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('narrator', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    // Choose template based on narration mode
    const templateName = context.narrationMode === 'scene-picture' ? 'narrator-scene-picture' : 'narrator';
    const systemPrompt = this.renderTemplate(templateName, context);
    const response = await this.callLLM(systemPrompt, context.userInput);
    return this.cleanResponse(response as string);
  }
}