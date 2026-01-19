import { describe, it, expect } from 'vitest';
import { buildJsonReturnTemplate } from '../agents/context/jsonTemplates.js';

describe('buildJsonReturnTemplate', () => {
  it('returns null for non-JSON agents', () => {
    const tpl = buildJsonReturnTemplate({ expectsJson: false } as any);
    expect(tpl).toBeNull();
  });

  it('returns object-mode instructions with example', () => {
    const tpl = buildJsonReturnTemplate({ expectsJson: true, jsonMode: 'object', jsonExample: { ok: true } } as any);
    expect(tpl?.instructions).toContain('Return ONLY a JSON object');
    expect(tpl?.example).toEqual({ ok: true });
    expect(tpl?.schema).toBeUndefined();
  });

  it('returns schema-mode instructions with schema payload', () => {
    const schema = { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] };
    const tpl = buildJsonReturnTemplate({ expectsJson: true, jsonMode: 'schema', jsonSchema: schema } as any);
    expect(tpl?.instructions).toContain('schema');
    expect(tpl?.schema).toEqual(schema);
    expect(tpl?.example).toBeUndefined();
  });
});
