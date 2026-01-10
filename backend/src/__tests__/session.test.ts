import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../agents/Orchestrator';
import CharacterService from '../services/CharacterService';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Mock the database and services
vi.mock('better-sqlite3');
vi.mock('../services/CharacterService');
vi.mock('../configManager', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    getProfile: vi.fn().mockReturnValue({}),
    reloadConfig: vi.fn(),
  })),
}));
vi.mock('nunjucks', () => ({
  Environment: vi.fn().mockImplementation(() => ({
    renderString: vi.fn().mockReturnValue('rendered template'),
  })),
}));

describe('Session API - buildSessionContext', () => {
  let mockDb: any;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    // Mock the database
    mockDb = {
      prepare: vi.fn().mockReturnThis(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    };
    (Database as any).mockReturnValue(mockDb);

    // Mock CharacterService
    (CharacterService.getMergedCharacter as any) = vi.fn();

    // Create orchestrator instance
    orchestrator = new Orchestrator({} as any, {} as any, mockDb);
  });

  it('should return activeCharacters in session context when scene has active characters', async () => {
    // Mock scene data with activeCharacters as UUIDs
    const mockScene = {
      id: 2,
      arcId: 1,
      title: "Hex's office",
      description: null,
      location: "Hex's office",
      timeOfDay: null,
      elapsedMinutes: 0,
      notes: null,
      backgroundImage: null,
      locationRelationships: null,
      summary: null,
      lastSummarizedMessageId: null,
      summaryTokenCount: 0,
      worldState: null,
      lastWorldStateMessageNumber: 0,
      characterStates: null,
      activeCharacters: '["uuid-raven"]', // JSON array of UUIDs
    };

    const mockArc = { id: 1, campaignId: 1, orderIndex: 1, name: 'First Arc', description: null };
    const mockCampaign = { id: 1, worldId: 1, slug: 'campaign-1', name: 'Campaign 1', description: null };
    const mockWorld = { id: 1, slug: 'world-1', name: 'World 1', description: null };

    // Mock DB queries
    mockDb.get
      .mockReturnValueOnce(mockScene) // scene
      .mockReturnValueOnce(mockArc) // arc
      .mockReturnValueOnce(mockCampaign) // campaign
      .mockReturnValueOnce(mockWorld); // world

    mockDb.all
      .mockReturnValueOnce([]) // lore
      .mockReturnValueOnce({ campaignId: 1, currentSceneId: 2, elapsedMinutes: 0, dynamicFacts: '{}', trackers: '{}', updatedAt: null }); // campaignState

    // Mock CharacterService to return a merged character
    const mockMergedCharacter = { id: 'uuid-raven', name: 'Raven', avatar: null, appearance: {}, personality: 'Brave' };
    (CharacterService.getMergedCharacter as any).mockReturnValue(mockMergedCharacter);

    // Call buildSessionContext
    const result = await orchestrator.buildSessionContext(2);

    // Assertions
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    if (!result) throw new Error('Expected result not to be null');
    expect(result.activeCharacters).toBeDefined();
    expect(result.activeCharacters).toHaveLength(1);
    expect(result.activeCharacters[0]).toEqual(mockMergedCharacter);
    expect(result.activeCharacters[0].name).toBe('Raven');
    expect(result.activeCharacters[0].id).toBe('uuid-raven');

    // Verify CharacterService was called with correct UUID
    expect(CharacterService.getMergedCharacter).toHaveBeenCalledWith({
      characterId: 'uuid-raven',
      worldId: 1,
      campaignId: 1,
    });
  });

  it('should return empty activeCharacters when scene has no active characters', async () => {
    // Mock scene data without activeCharacters
    const mockScene = {
      id: 3,
      arcId: 1,
      title: 'Empty Scene',
      description: null,
      location: 'Somewhere',
      timeOfDay: null,
      elapsedMinutes: 0,
      notes: null,
      backgroundImage: null,
      locationRelationships: null,
      summary: null,
      lastSummarizedMessageId: null,
      summaryTokenCount: 0,
      worldState: null,
      lastWorldStateMessageNumber: 0,
      characterStates: null,
      activeCharacters: null, // No active characters
    };

    const mockArc = { id: 1, campaignId: 1, orderIndex: 1, name: 'First Arc', description: null };
    const mockCampaign = { id: 1, worldId: 1, slug: 'campaign-1', name: 'Campaign 1', description: null };
    const mockWorld = { id: 1, slug: 'world-1', name: 'World 1', description: null };

    // Mock DB queries
    mockDb.get
      .mockReturnValueOnce(mockScene)
      .mockReturnValueOnce(mockArc)
      .mockReturnValueOnce(mockCampaign)
      .mockReturnValueOnce(mockWorld);

    mockDb.all
      .mockReturnValueOnce([]) // lore
      .mockReturnValueOnce({ campaignId: 1, currentSceneId: 3, elapsedMinutes: 0, dynamicFacts: '{}', trackers: '{}', updatedAt: null }); // campaignState

    // Call buildSessionContext
    const result = await orchestrator.buildSessionContext(3);

    // Assertions
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    if (!result) throw new Error('Expected result not to be null');
    expect(result.activeCharacters).toBeDefined();
    expect(result.activeCharacters).toHaveLength(0);
  });
});