#!/usr/bin/env node
/**
 * Debug script to manually query vector memory store
 * Usage: node debug-vector-query.js "query text" [worldId] [characterName] [includeMultiChar]
 * Examples:
 *   node debug-vector-query.js "dragon attack" 9999999
 *   node debug-vector-query.js "magical spellcasting" 9999999 Alice
 *   node debug-vector-query.js "tavern gathering" 9999999 false true
 */

import path from 'path';
import fs from 'fs';

// Import as defaults since compiled modules are CommonJS
import VectraVectorStoreModule from '../dist/backend/src/stores/VectraVectorStore.js';
import memoryRetrieverModule from '../dist/backend/src/utils/memoryRetriever.js';

const { VectraVectorStore } = VectraVectorStoreModule;
const { getMemoryRetriever } = memoryRetrieverModule;

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node debug-vector-query.js "query text" [worldId] [characterName] [includeMultiChar]');
    console.log('Examples:');
    console.log('  node debug-vector-query.js "dragon attack" 9999999');
    console.log('  node debug-vector-query.js "magical spellcasting" 9999999 Alice');
    console.log('  node debug-vector-query.js "tavern gathering" 9999999 alice true');
    process.exit(1);
  }

  const query = args[0];
  const worldId = parseInt(args[1]) || 9999999;
  const characterName = args[2] || undefined;
  const includeMultiChar = args[3] ? args[3].toLowerCase() === 'true' : false;

  console.log('\n========== VECTOR MEMORY QUERY DEBUG ==========');
  console.log(`Query: "${query}"`);
  console.log(`World ID: ${worldId}`);
  console.log(`Character: ${characterName || 'global (all scopes)'}`);
  console.log(`Include multi-char: ${includeMultiChar}`);
  console.log('============================================\n');

  try {
    // Initialize vector store
    const vectorStore = new VectraVectorStore('./vector_data');
    console.log('[INIT] Initializing vector store...');

    // Use the singleton retriever
    const retriever = getMemoryRetriever();
    console.log('[INIT] Initializing memory retriever...');
    await retriever.initialize();
    console.log('[INIT] ✓ Ready\n');

    // Run query
    console.log('[QUERY] Executing query...');
    const memories = await retriever.queryMemories(query, {
      worldId,
      characterName: characterName,
      topK: 10,
      minSimilarity: 0.1,
      includeMultiCharacter: includeMultiChar,
    });

    console.log(`[RESULTS] Found ${memories.length} memories:\n`);

    if (memories.length === 0) {
      console.log('  (no results)\n');
    } else {
      memories.forEach((mem, idx) => {
        console.log(`  ${idx + 1}. [${(mem.similarity * 100).toFixed(1)}%] ${mem.characterName}`);
        console.log(`     Scope: ${mem.scope}`);
        console.log(`     Text: ${mem.text.substring(0, 80)}${mem.text.length > 80 ? '...' : ''}`);
        if (mem.metadata) {
          console.log(`     Metadata: ${JSON.stringify(mem.metadata)}`);
        }
        console.log();
      });
    }

    // Show stats
    console.log('[STATS]');
    const stats = vectorStore.getStats();
    console.log(`  Total scopes: ${stats.totalScopes}`);
    console.log(`  Total memories: ${stats.totalMemories}`);
    console.log(`  Scopes in system:\n`);
    for (const scope of stats.scopes) {
      console.log(`    - ${scope.name}: ${scope.memories} memories`);
    }

  } catch (error) {
    console.error('[ERROR]', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
