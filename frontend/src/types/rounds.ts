/**
 * Type definitions for Rounds feature
 */

export interface MessageRow {
  id: number;
  sceneId: number;
  messageNumber: number;
  message: string;
  sender: string;
  timestamp: string;
  charactersPresent: string[];
  tokenCount: number;
  metadata?: Record<string, any>;
  source?: string;
  roundNumber: number;
}

export interface RoundCompletedEvent {
  sceneId: number;
  roundNumber: number;
  activeCharacters: string[];
  autoTriggered?: boolean;
  timestamp?: string;
}

export interface SceneRoundsMetadata {
  id: number;
  sceneId: number;
  roundNumber: number;
  status: 'in-progress' | 'completed';
  activeCharacters: string[];
  roundStartedAt: string;
  roundCompletedAt?: string | null;
  vectorized: boolean;
  vectorizedAt?: string | null;
}

export interface RoundData {
  roundNumber: number;
  messages: MessageRow[];
  metadata?: SceneRoundsMetadata;
  activeCharacters: string[];
  messageCount: number;
}
