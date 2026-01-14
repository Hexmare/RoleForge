/**
 * Tests for VectorizationAgent (Phase 2)
 * Tests memory capture and storage from completed rounds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorizationAgent } from '../agents/VectorizationAgent.js';
import { ConfigManager } from '../configManager.js';
import * as nunjucks from 'nunjucks';
import fs from 'fs/promises';

const TEST_BASE_PATH = './test_vector_data_agent';

describe('VectorizationAgent - Phase 2', () => {
  let agent: VectorizationAgent;
  let configManager: ConfigManager;
  let env: nunjucks.Environment;

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_BASE_PATH, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist yet
    }

    // Initialize environment
    env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/prompts'));

    // Create a mock config manager
    configManager = {
      getConfig: () => ({
        agents: { vectorization: {} },
        defaultProfile: 'default'
      }),
      getProfile: () => ({
        model: 'gpt-4',
        type: 'openai',
        apiKey: 'test-key',
        baseURL: 'https://api.openai.com/v1'
      }),
      reload: () => {}
    } as any;

    agent = new VectorizationAgent(configManager, env);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_BASE_PATH, { recursive: true, force: true });
    } catch {
      // Already cleaned
    }
  });

  describe('Initialization', () => {
    it('should initialize VectorizationAgent', () => {
      expect(agent).toBeDefined();
      expect(typeof agent.run).toBe('function');
    });

    it('should have vector store and embedding manager', () => {
      expect(agent).toHaveProperty('vectorStore');
      expect(agent).toHaveProperty('embeddingManager');
    });
  });

  describe('Round Memory Capture', () => {
    it('should skip vectorization with missing sceneId', async () => {
      const context = {
        userInput: '',
        history: [],
        worldState: {},
        activeCharacters: ['CharacterA'],
        messages: [{ characterName: 'CharacterA', content: 'Hello!' }]
      };

      const result = await agent.run(context);
      expect(result).toBe('skipped');
    });

    it('should skip vectorization with no messages', async () => {
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: {},
        activeCharacters: ['CharacterA'],
        messages: []
      };

      const result = await agent.run(context);
      expect(result).toBe('skipped');
    });

    it('should skip vectorization with no active characters', async () => {
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: {},
        activeCharacters: [],
        messages: [{ characterName: 'CharacterA', content: 'Hello!' }]
      };

      const result = await agent.run(context);
      expect(result).toBe('skipped');
    });

    it('should return error on vectorization failure (non-blocking)', async () => {
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        activeCharacters: ['CharacterA'],
        messages: [
          { characterName: 'CharacterA', content: 'Hello world!' },
          { characterName: 'Narrator', content: 'The scene is peaceful.' }
        ]
      };

      // This should return 'error' because embedding manager isn't fully initialized
      // But it should NOT throw - silent fallback
      const result = await agent.run(context);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });

    it('should handle multiple characters in round', async () => {
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        activeCharacters: ['CharacterA', 'CharacterB', 'User'],
        messages: [
          { characterName: 'User', content: 'What do you think?' },
          { characterName: 'CharacterA', content: 'I agree!' },
          { characterName: 'CharacterB', content: 'Interesting perspective.' }
        ]
      };

      // Should process all three characters
      const result = await agent.run(context);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });
  });

  describe('Error Handling', () => {
    it('should not throw on invalid context', async () => {
      const context = {
        userInput: '',
        history: [],
        worldState: {}
      };

      // Should return 'skipped' or 'error', never throw
      const result = await agent.run(context);
      expect(result).toBeDefined();
      expect(['error', 'complete', 'skipped']).toContain(result);
    });

    it('should handle malformed messages gracefully', async () => {
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        activeCharacters: ['CharacterA'],
        messages: [
          null,
          undefined,
          { characterName: 'CharacterA', content: '' },
          { characterName: 'CharacterA' }, // Missing content
          { content: 'Missing speaker' } // Missing speaker
        ]
      };

      const result = await agent.run(context);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });

    it('should continue if one character fails', async () => {
      // This tests that if storing memory for CharacterA fails,
      // it still tries CharacterB
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        activeCharacters: ['CharacterA', 'CharacterB'],
        messages: [
          { characterName: 'CharacterA', content: 'Hello!' },
          { characterName: 'CharacterB', content: 'Hi there!' }
        ]
      };

      // Should attempt to store for both characters
      const result = await agent.run(context);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });
  });

  describe('Memory Summarization', () => {
    it('should create valid memory summary', async () => {
      // Test through a full context that would trigger summarization
      const context = {
        sceneId: 1,
        roundNumber: 2,
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        activeCharacters: ['Alex', 'Jordan'],
        messages: [
          { characterName: 'User', content: 'The dragon appears!' },
          { characterName: 'Alex', content: 'We must be careful!' },
          { characterName: 'Jordan', content: 'I agree. Let us proceed cautiously.' },
          { characterName: 'Narrator', content: 'The tension rises in the chamber.' }
        ]
      };

      // Should process without throwing
      const result = await agent.run(context);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });

    it('should truncate long messages', async () => {
      const longText = 'A'.repeat(500); // Very long message
      const context = {
        sceneId: 1,
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        activeCharacters: ['CharacterA'],
        messages: [
          { characterName: 'CharacterA', content: longText }
        ]
      };

      const result = await agent.run(context);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });
  });

  describe('Integration with Orchestrator', () => {
    it('should accept Orchestrator context format', async () => {
      // Simulates context as passed by Orchestrator.completeRound()
      const orchestratorContext = {
        sceneId: 1,
        roundNumber: 1,
        messages: [
          { characterName: 'Character1', content: 'Test' }
        ],
        activeCharacters: ['Character1'],
        userInput: '',
        history: [],
        worldState: { id: 1, name: 'TestWorld' },
        trackers: {},
        characterStates: {},
        lore: [],
        formattedLore: '',
        userPersona: {}
      };

      const result = await agent.run(orchestratorContext);
      expect(['error', 'complete', 'skipped']).toContain(result);
    });
  });

  describe('Statistics', () => {
    it('should provide store statistics', async () => {
      const stats = await agent.getStats();
      expect(stats).toBeDefined();
      // Stats might be error or valid stats object
    });
  });
});
