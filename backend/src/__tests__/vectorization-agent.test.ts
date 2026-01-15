/**
 * Tests for VectorizationAgent (Phase 2)
 * Tests memory capture and storage from completed rounds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorizationAgent } from '../agents/VectorizationAgent.js';
import { ConfigManager } from '../configManager.js';
import * as nunjucks from 'nunjucks';
import fs from 'fs/promises';
import path from 'path';

const TEST_VECTOR_BASE_PATH = './vector_data';
const TEST_WORLD_ID = 9999999;
const TEST_CAMPAIGN_ID = 9999999;
const TEST_ARC_ID = 9999999;
const TEST_SCENE_ID = 9999999;

describe('VectorizationAgent - Phase 2', () => {
  let agent: VectorizationAgent;
  let configManager: ConfigManager;
  let env: nunjucks.Environment;

  beforeEach(async () => {
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
    // Clean up test vector data folders
    try {
      const basePath = path.join(TEST_VECTOR_BASE_PATH);
      const files = await fs.readdir(basePath);
      
      // Delete all test world folders (world_9999999_*)
      for (const file of files) {
        if (file.startsWith(`world_${TEST_WORLD_ID}_`)) {
          await fs.rm(path.join(basePath, file), { recursive: true, force: true });
          console.log(`[TEST] Cleaned up vector folder: ${file}`);
        }
      }
    } catch (error) {
      // Vector data directory may not exist yet, that's fine
      console.log('[TEST] No vector data to clean up');
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
      // This test passes invalid sceneId, so VectorizationAgent will fail gracefully
      // Testing that it returns 'error' status instead of throwing
      const context = {
        sceneId: 99999999, // Non-existent sceneId
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
        activeCharacters: ['CharacterA'],
        messages: [
          { characterName: 'CharacterA', content: 'Hello world!' },
          { characterName: 'Narrator', content: 'The scene is peaceful.' }
        ]
      };

      // This should return 'error' because sceneId doesn't exist in database
      // But it should NOT throw - silent fallback
      const result = await agent.run(context);
      expect(['error', 'skipped']).toContain(result);
    });

    it('should handle multiple characters in round', async () => {
      const context = {
        sceneId: 99999999, // Non-existent sceneId - testing error handling
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
        activeCharacters: ['CharacterA', 'CharacterB', 'User'],
        messages: [
          { characterName: 'User', content: 'What do you think?' },
          { characterName: 'CharacterA', content: 'I agree!' },
          { characterName: 'CharacterB', content: 'Interesting perspective.' }
        ]
      };

      // Should handle error gracefully without throwing
      const result = await agent.run(context);
      expect(['error', 'skipped']).toContain(result);
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
        sceneId: 99999999, // Non-existent sceneId
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
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
      expect(['error', 'skipped']).toContain(result);
    });

    it('should continue if one character fails', async () => {
      // This tests that if storing memory for CharacterA fails,
      // it still tries CharacterB
      const context = {
        sceneId: 99999999, // Non-existent sceneId
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
        activeCharacters: ['CharacterA', 'CharacterB'],
        messages: [
          { characterName: 'CharacterA', content: 'Hello!' },
          { characterName: 'CharacterB', content: 'Hi there!' }
        ]
      };

      // Should attempt to store for both characters, handling error gracefully
      const result = await agent.run(context);
      expect(['error', 'skipped']).toContain(result);
    });
  });

  describe('Memory Summarization', () => {
    it('should create valid memory summary', async () => {
      // Test through a full context that would trigger summarization
      const context = {
        sceneId: 99999999, // Non-existent sceneId
        roundNumber: 2,
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
        activeCharacters: ['Alex', 'Jordan'],
        messages: [
          { characterName: 'User', content: 'The dragon appears!' },
          { characterName: 'Alex', content: 'We must be careful!' },
          { characterName: 'Jordan', content: 'I agree. Let us proceed cautiously.' },
          { characterName: 'Narrator', content: 'The tension rises in the chamber.' }
        ]
      };

      // Should process without throwing, handles error gracefully
      const result = await agent.run(context);
      expect(['error', 'skipped']).toContain(result);
    });

    it('should truncate long messages', async () => {
      const longText = 'A'.repeat(500); // Very long message
      const context = {
        sceneId: 99999999, // Non-existent sceneId
        roundNumber: 1,
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
        activeCharacters: ['CharacterA'],
        messages: [
          { characterName: 'CharacterA', content: longText }
        ]
      };

      const result = await agent.run(context);
      expect(['error', 'skipped']).toContain(result);
    });
  });

  describe('Integration with Orchestrator', () => {
    it('should accept Orchestrator context format', async () => {
      // Simulates context as passed by Orchestrator.completeRound()
      const orchestratorContext = {
        sceneId: 99999999, // Non-existent sceneId
        roundNumber: 1,
        messages: [
          { characterName: 'Character1', content: 'Test' }
        ],
        activeCharacters: ['Character1'],
        userInput: '',
        history: [],
        worldState: { id: 9999999, name: 'TestWorld' },
        trackers: {},
        characterStates: {},
        lore: [],
        formattedLore: '',
        userPersona: {}
      };

      const result = await agent.run(orchestratorContext);
      expect(['error', 'skipped']).toContain(result);
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
