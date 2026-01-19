import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nunjucks from 'nunjucks';
import { ConfigManager, AgentConfig, Config } from '../configManager.js';
import { BaseAgent } from '../agents/BaseAgent.js';
import { validateAgentJson } from '../agents/context/jsonValidation.js';
import { chatCompletion } from '../llm/client';

vi.mock('../llm/client', () => ({
  chatCompletion: vi.fn()
}));

class TestAgent extends BaseAgent {
  constructor(agentName: string, manager: ConfigManager) {
    super(agentName, manager, new nunjucks.Environment());
  }

  async run(): Promise<string> {
    return this.callLLM('system', 'user');
  }
}

const chatMock = vi.mocked(chatCompletion);

function writeConfig(tmpDir: string, agentConfig: AgentConfig, features: Config['features'] = {}): string {
  const configPath = path.join(tmpDir, 'config.json');
  const config: Config = {
    defaultProfile: 'openai',
    profiles: {
      openai: {
        type: 'openai',
        baseURL: 'http://localhost',
        model: 'gpt-3.5-turbo',
        template: 'chatml'
      }
    },
    comfyui: undefined as any,
    agents: {
      testAgent: agentConfig
    },
    features
  } as Config;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

describe('JSON validation with retries', () => {
  let tmpDir: string;

  beforeEach(() => {
    chatMock.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-json-'));
  });

  it('retries once on invalid JSON and succeeds on second attempt', async () => {
    const agentConfig: AgentConfig = {
      expectsJson: true,
      jsonMode: 'schema',
      jsonSchema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
        additionalProperties: false
      }
    };
    const configPath = writeConfig(tmpDir, agentConfig, {
      jsonValidationEnabled: true,
      jsonValidationDevLog: true,
      jsonValidationMaxRetries: 1
    });

    const manager = new ConfigManager(configPath);
    const agent = new TestAgent('testAgent', manager);

    chatMock.mockResolvedValueOnce('{"foo":123}');
    chatMock.mockResolvedValueOnce('{"foo":"ok"}');

    const result = await agent.run();
    expect(JSON.parse(result)).toEqual({ foo: 'ok' });
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces error payload when retries are exhausted', async () => {
    const agentConfig: AgentConfig = {
      expectsJson: true,
      jsonMode: 'schema',
      jsonSchema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
        additionalProperties: false
      }
    };
    const configPath = writeConfig(tmpDir, agentConfig, {
      jsonValidationEnabled: true,
      jsonValidationMaxRetries: 1
    });

    const manager = new ConfigManager(configPath);
    const agent = new TestAgent('testAgent', manager);

    chatMock.mockResolvedValue('{"foo":123}');

    const result = await agent.run();
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('failed_json_validation');
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('bypasses validation for non-JSON agents', async () => {
    const agentConfig: AgentConfig = {
      expectsJson: false
    };
    const configPath = writeConfig(tmpDir, agentConfig, {
      jsonValidationEnabled: true,
      jsonValidationMaxRetries: 1
    });

    const manager = new ConfigManager(configPath);
    const agent = new TestAgent('testAgent', manager);

    chatMock.mockResolvedValue('plain text');

    const result = await agent.run();
    expect(result).toBe('plain text');
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('validates object mode responses as objects', async () => {
    const agentConfig: AgentConfig = {
      jsonMode: 'object',
      expectsJson: true,
      jsonExample: { ok: true }
    };
    const configPath = writeConfig(tmpDir, agentConfig, {
      jsonValidationEnabled: true,
      jsonValidationMaxRetries: 0
    });

    const manager = new ConfigManager(configPath);
    const agent = new TestAgent('testAgent', manager);

    // First call returns array (invalid), with retries disabled we surface validation error payload
    chatMock.mockResolvedValueOnce('[1,2,3]');
    const result = await agent.run();
    expect(JSON.parse(result).error).toBe('failed_json_validation');

    // When valid object is returned, it is coerced to stringified object
    chatMock.mockResolvedValueOnce('{"ok":true}');
    const second = await agent.run();
    expect(second).toBe('{"ok":true}');
  });
});

describe('validateAgentJson error details', () => {
  it('returns path-aware errors for schema validation', () => {
    const agentConfig: AgentConfig = {
      expectsJson: true,
      jsonMode: 'schema',
      jsonSchema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo']
      }
    };

    const result = validateAgentJson(agentConfig, '{"bar":1}');
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('foo');
    expect(result.errorDetails?.[0]?.path).toBe('(root)');
  });
});
