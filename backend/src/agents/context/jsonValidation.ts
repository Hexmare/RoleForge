import Ajv, { ValidateFunction } from 'ajv';
import tryJsonRepair from '../../utils/jsonRepair.js';
import { AgentConfig } from '../../configManager.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaCache = new WeakMap<any, ValidateFunction>();

export interface JsonValidationResult {
  valid: boolean;
  parsed: any | null;
  errors?: string[];
  errorDetails?: { path: string; message: string }[];
  repaired?: boolean;
}

function compileSchema(schema: any): ValidateFunction {
  const key = typeof schema === 'object' ? schema : String(schema);
  const cached = schemaCache.get(key as any);
  if (cached) return cached;
  const parsed = typeof schema === 'string' ? JSON.parse(schema) : schema;
  const validator = ajv.compile(parsed);
  schemaCache.set(key as any, validator);
  return validator;
}

export function validateAgentJson(agentConfig: AgentConfig | undefined, raw: string): JsonValidationResult {
  if (!agentConfig || !(agentConfig.expectsJson || agentConfig.jsonMode || agentConfig.returnsJson)) {
    return { valid: true, parsed: null };
  }

  let parsed: any = null;
  let repaired = false;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const repairedText = tryJsonRepair(raw);
    if (repairedText) {
      try {
        parsed = JSON.parse(repairedText);
        repaired = true;
      } catch {
        return { valid: false, parsed: null, errors: ['parse_failed'], repaired: true };
      }
    } else {
      return { valid: false, parsed: null, errors: ['parse_failed'], repaired: false };
    }
  }

  if (agentConfig.jsonMode === 'schema' && agentConfig.jsonSchema) {
    try {
      const validator = compileSchema(agentConfig.jsonSchema);
      const ok = validator(parsed);
      if (ok) return { valid: true, parsed, repaired };
      const errors = (validator.errors || []).map(err => `${err.instancePath || '(root)'} ${err.message || ''}`.trim());
      const errorDetails = (validator.errors || []).map(err => ({ path: err.instancePath || '(root)', message: err.message || '' }));
      return { valid: false, parsed, errors, errorDetails, repaired };
    } catch (e: any) {
      return { valid: false, parsed, errors: [e?.message || 'schema_compile_failed'], repaired };
    }
  }

  if (agentConfig.jsonMode === 'object' || agentConfig.expectsJson || agentConfig.returnsJson) {
    const isObj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    if (isObj) return { valid: true, parsed, repaired };
    return { valid: false, parsed, errors: ['not_an_object'], errorDetails: [{ path: '(root)', message: 'not_an_object' }], repaired };
  }

  return { valid: true, parsed, repaired };
}
