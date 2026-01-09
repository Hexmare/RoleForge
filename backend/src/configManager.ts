import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SamplerSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  max_completion_tokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  maxContextTokens?: number; // Maximum total context length in tokens
  forceJson?: boolean;
  logitBias?: Record<string, number>;
  n?: number;
}

export interface LLMProfile {
  type: 'openai';
  apiKey?: string;
  baseURL: string;
  model?: string;
  template?: string; // LLM template name, e.g., 'chatml'
  sampler?: SamplerSettings;
}

export interface Config {
  comfyui: any;
  profiles: Record<string, LLMProfile>;
  defaultProfile: string;
  agents?: Record<string, { llmProfile: string }>;
  features?: {
    visualAgentEnabled?: boolean;
  };
}

export class ConfigManager {
  private config: Config;

  constructor(configPath: string = path.join(__dirname, '..', 'config.json')) {
    this.config = this.loadConfig(configPath);
  }

  private loadConfig(configPath: string): Config {
    if (!fs.existsSync(configPath)) {
      // Create dummy config
      const dummyConfig: Config = {
        defaultProfile: 'openai',
        profiles: {
          openai: {
            type: 'openai',
            apiKey: 'sk-dummy-key',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-3.5-turbo'
          }
        },
        comfyui: undefined
      };
      fs.writeFileSync(configPath, JSON.stringify(dummyConfig, null, 2));
      return dummyConfig;
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  getProfile(name?: string): LLMProfile {
    const profileName = name || this.config.defaultProfile;
    const profile = this.config.profiles[profileName];
    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }
    return profile;
  }

  getDefaultProfile(): LLMProfile {
    return this.getProfile();
  }

  getConfig(): Config {
    return this.config;
  }

  reload(): void {
    this.config = this.loadConfig(path.join(__dirname, '..', 'config.json'));
  }

  isVisualAgentEnabled(): boolean {
    return this.config.features?.visualAgentEnabled ?? false;
  }
}