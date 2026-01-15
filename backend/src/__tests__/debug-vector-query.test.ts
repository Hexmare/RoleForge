/**
 * Debug test to manually query vector memories
 * Run with: npx vitest run src/__tests__/debug-vector-query.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { VectraVectorStore } from '../stores/VectraVectorStore';
import { getMemoryRetriever } from '../utils/memoryRetriever';

describe('Vector Memory Debug Query', () => {
  it('should query vector memories', { timeout: 30000 }, async () => {
    const query = process.env.QUERY || 'raven';
    const worldId = parseInt(process.env.WORLD_ID || '9999999');
    const characterName = process.env.CHARACTER || undefined;
    const includeMultiChar = process.env.MULTI === 'true';

    console.log('\n========== VECTOR MEMORY QUERY DEBUG ==========');
    console.log(`Query: "${query}"`);
    console.log(`World ID: ${worldId}`);
    console.log(`Character: ${characterName || 'global (all scopes)'}`);
    console.log(`Include multi-char: ${includeMultiChar}`);
    console.log('============================================\n');

    // Initialize
    const retriever = getMemoryRetriever();
    await retriever.initialize();

    // Run query
    console.log('[QUERY] Executing query...');
    const memories = await retriever.queryMemories(query, {
      worldId,
      characterName,
      topK: 10,
      minSimilarity: 0.1,
      includeMultiCharacter: includeMultiChar,
    });

    console.log(`[RESULTS] Found ${memories.length} memories:\n`);

    if (memories.length === 0) {
      console.log('  (no results)\n');
    } else {
      memories.forEach((mem, idx) => {
        console.log(`  ${idx + 1}. [${((mem.similarity || 0) * 100).toFixed(1)}%] ${mem.characterName}`);
        console.log(`     Scope: ${mem.scope}`);
        console.log(`     Text: ${mem.text.substring(0, 80)}${mem.text.length > 80 ? '...' : ''}`);
        console.log();
      });
    }

    expect(true).toBe(true); // Always pass - this is just for output
  });
});
