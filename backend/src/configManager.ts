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
  type: 'openai' | 'custom'; // 'openai' uses OpenAI SDK, 'custom' uses axios with templates
  apiKey?: string;
  baseURL: string;
  model?: string;
  template?: string; // LLM template name, e.g., 'chatml' for openai, custom templates for 'custom' type
  sampler?: SamplerSettings;
  format?: string; // Response format, e.g., 'json'
  fallbackProfiles?: string[]; // Profile names to try if this one fails
}

export interface AgentConfig {
  llmProfile?: string;
  sampler?: SamplerSettings;
  format?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  template?: string;
  returnsJson?: boolean; // Indicates if agent returns JSON responses
}

export interface Config {
  comfyui: any;
  profiles: Record<string, LLMProfile>;
  defaultProfile: string;
  agents?: Record<string, AgentConfig>;
  features?: {
    visualAgentEnabled?: boolean;
    socketAckLogs?: boolean;
    summarizationInterval?: number;
    maxSummaryTokens?: number;
  };
  vector?: any;
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

  // Load vector config from backend/config/vectorConfig.json if present
  private loadVectorConfig(): any {
    try {
      const vcPath = path.join(__dirname, '..', 'config', 'vectorConfig.json');
      if (fs.existsSync(vcPath)) {
        const raw = fs.readFileSync(vcPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to load vectorConfig.json', e);
    }
    return undefined;
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
    // attach vector config dynamically
    const copy = { ...this.config } as Config;
    const vector = this.loadVectorConfig();
    if (vector) copy.vector = vector;
    return copy;
  }

  reload(): void {
    this.config = this.loadConfig(path.join(__dirname, '..', 'config.json'));
  }

  getVectorConfig(): any {
    return this.loadVectorConfig();
  }

  isVisualAgentEnabled(): boolean {
    return this.config.features?.visualAgentEnabled ?? false;
  }
}