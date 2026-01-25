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

export interface DebugSettings {
  enabledNamespaces?: string;
  colors?: boolean;
  whitelist?: string[];
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
  expectsJson?: boolean; // New: enforce JSON response
  jsonMode?: 'object' | 'schema'; // New: controls template injection
  jsonSchema?: string | Record<string, any>; // New: inline schema when jsonMode === 'schema'
  jsonExample?: Record<string, any>; // New: example object when jsonMode === 'object'
}

export interface Config {
  comfyui: any;
  profiles: Record<string, LLMProfile>;
  defaultProfile: string;
  agents?: Record<string, AgentConfig>;
  features?: {
    visualAgentEnabled?: boolean;
    worldAgentEnabled?: boolean;
    socketAckLogs?: boolean;
    summarizationEnabled?: boolean;
    summarizationInterval?: number;
    summarizationRoundInterval?: number;
    maxSummaryTokens?: number;
    historyWindowMessages?: number;
    summarizationTriggerMessages?: number;
    jsonValidationEnabled?: boolean;
    jsonValidationDevLog?: boolean;
    jsonValidationMaxRetries?: number;
    maxDirectorPasses?: number;
  };
  vector?: any;
  debug?: DebugSettings;
}

export class ConfigManager {
  private config: Config;
  private readonly configPath: string;

  constructor(configPath: string = path.join(__dirname, '..', '..', 'localConfig', 'config.json')) {
    this.configPath = configPath;
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
        comfyui: undefined,
        debug: {
          enabledNamespaces: 'roleforge:llm:*,roleforge:image:gen',
          colors: true,
          whitelist: ['roleforge:*']
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(dummyConfig, null, 2));
      return dummyConfig;
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    this.validateAgentConfigs(parsed?.agents || {});
    return parsed;
  }

  private validateAgentConfigs(agents: Record<string, AgentConfig>): void {
    for (const [name, cfg] of Object.entries(agents)) {
      if (!cfg) continue;
      if ((cfg.jsonMode === 'schema' || cfg.expectsJson) && !cfg.jsonSchema && cfg.jsonMode === 'schema') {
        console.warn(`[configManager] Agent ${name} expects schema mode but no jsonSchema provided.`);
      }
      if ((cfg.jsonMode === 'object' || cfg.expectsJson) && cfg.jsonMode === 'object' && !cfg.jsonExample) {
        // Example optional; no warning
      }
    }
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
    this.config = this.loadConfig(this.configPath);
  }

  getVectorConfig(): any {
    return this.loadVectorConfig();
  }

  isVisualAgentEnabled(): boolean {
    return this.config.features?.visualAgentEnabled ?? false;
  }

  isWorldAgentEnabled(): boolean {
    return this.config.features?.worldAgentEnabled ?? false;
  }

  isDirectorAgentEnabled(): boolean {
    return this.config.features?.directorAgentEnabled ?? false;
  }

  updateDebugSettings(updates: Partial<DebugSettings>): Config {
    const nextDebug: DebugSettings = {
      ...this.config.debug,
      ...updates
    };
    this.config = {
      ...this.config,
      debug: nextDebug
    };
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    return this.getConfig();
  }
}