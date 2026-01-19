import { AgentConfig } from '../../configManager.js';

export interface JsonTemplateResult {
  instructions: string;
  schema?: string | Record<string, any>;
  example?: Record<string, any>;
}

/**
 * Build JSON return instructions to inject into prompts based on agent config.
 */
export function buildJsonReturnTemplate(agentConfig?: AgentConfig): JsonTemplateResult | null {
  if (!agentConfig || !(agentConfig.expectsJson || agentConfig.jsonMode || agentConfig.returnsJson)) {
    return null;
  }

  const mode = agentConfig.jsonMode || 'object';

  if (mode === 'schema' && agentConfig.jsonSchema) {
    return {
      instructions: 'Return ONLY JSON matching the provided schema. Do not include prose or markdown.',
      schema: agentConfig.jsonSchema
    };
  }

  return {
    instructions: 'Return ONLY a JSON object. Do not include prose or markdown.',
    example: agentConfig.jsonExample
  };
}
