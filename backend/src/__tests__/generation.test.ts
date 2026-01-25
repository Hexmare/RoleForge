import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { chatCompletion } from '../llm/client';
import { CreatorAgent } from '../agents/CreatorAgent';
import { ConfigManager } from '../configManager';

// Mock nunjucks
vi.mock('nunjucks', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    configure: vi.fn(() => ({
      renderString: vi.fn((template, context) => {
        // Simple mock: replace {{key}} with value
        let result = template;
        for (const [key, value] of Object.entries(context)) {
          result = result.replace(new RegExp(`{{${key}}}`, 'g'), JSON.stringify(value));
        }
        return result;
      })
    }))
  };
});

// Mock the LLM client
vi.mock('../llm/client', () => ({
  chatCompletion: vi.fn(),
}));

// Mock configManager
vi.mock('../configManager', () => ({
  ConfigManager: class {
    reload() {
      // Mock reload, do nothing
    }
    getProfile() {
      return {
        type: 'openai',
        apiKey: 'test',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo',
      };
    }
    getConfig() {
      return {
        defaultProfile: 'openai',
        agents: {}
      };
    }
  },
}));

// Mock env
const mockEnv = {
  OPENAI_API_KEY: 'test-key',
  KOBOLD_API_URL: 'http://localhost:5001',
};

vi.mock('../utils/env', () => ({
  default: mockEnv,
}));

import * as nunjucks from 'nunjucks';

describe('Character and Persona Generation', () => {
  let configManager: ConfigManager;
  let env: nunjucks.Environment;
  let creatorAgent: CreatorAgent;

  beforeAll(() => {
    configManager = new ConfigManager();
    env = nunjucks.configure({});
    creatorAgent = new CreatorAgent(configManager, env);
  });

  it('should generate a character', async () => {
    const mockCharacter = {
      name: 'Test Character',
      species: 'Human',
      race: 'Human',
      gender: 'Male',
      description: 'A brave warrior',
      appearance: {
        physical: '6ft, 180lbs, athletic build, blue eyes, short brown hair',
        aesthetic: 'Modern, scar on cheek'
      },
      currentOutfit: 'Casual clothes',
      personality: 'Brave and kind',
      traits: {
        likes: ['Justice', 'honor'],
        dislikes: ['Cowardice'],
        kinks: []
      },
      abilities: ['Fighting', 'leadership'],
      occupation: 'Warrior at castle',
      sexualOrientation: 'Heterosexual',
      relationshipStatus: 'Single'
    };

    (chatCompletion as any).mockResolvedValue(JSON.stringify(mockCharacter));

    const context = {
      mode: 'create',
      name: 'Test Char',
      description: 'A test character',
      instructions: 'Make it heroic',
      schema: JSON.stringify({}), // Simplified
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };

    const result = await creatorAgent.run(context);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual(mockCharacter);
  });

  it('should generate a persona', async () => {
    const mockPersona = {
      name: 'Test Persona',
      species: 'Human',
      race: 'Elf',
      gender: 'Female',
      description: 'A wise elven mage',
      appearance: {
        physical: '5ft 6in, 130lbs, slender build, green eyes, long wavy blonde hair',
        aesthetic: 'Fantasy, pointed ears'
      },
      currentOutfit: 'Elven robes',
      personality: 'Wise and mysterious',
      traits: {
        likes: ['Nature', 'magic'],
        dislikes: ['Ignorance'],
        kinks: []
      },
      abilities: ['Magic', 'archery'],
      occupation: 'Mage at tower',
      sexualOrientation: 'Bisexual',
      relationshipStatus: 'Single'
    };

    (chatCompletion as any).mockResolvedValue(JSON.stringify(mockPersona));

    const context = {
      mode: 'create',
      name: 'Test Persona',
      description: 'A test persona',
      instructions: 'Make it magical',
      schema: JSON.stringify({}), // Simplified
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };

    const result = await creatorAgent.run(context);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual(mockPersona);
  });

  it('should update a character field', async () => {
    const existing = {
      name: 'Old Name',
      description: 'Old desc'
    };

    const updated = {
      name: 'Updated Name',
      description: 'Updated desc'
    };

    (chatCompletion as any).mockResolvedValue(JSON.stringify(updated));

    const context = {
      mode: 'update',
      existingData: existing,
      selectedFields: ['name', 'description'],
      instructions: 'Make it better',
      schema: JSON.stringify({}),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };

    const result = await creatorAgent.run(context);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual(updated);
  });

  it('should regenerate a specific field', async () => {
    const existing = {
      name: 'Test Char',
      description: 'Old desc'
    };

    (chatCompletion as any).mockResolvedValue('New description');

    const context = {
      mode: 'field',
      existingData: existing,
      field: 'description',
      instructions: 'Make it epic',
      schema: JSON.stringify({}),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };

    const result = await creatorAgent.run(context);

    expect(result).toBe('New description');
  });
});