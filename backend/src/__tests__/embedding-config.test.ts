import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import EmbeddingManager from '../utils/embeddingManager.js';

const cfgPath = path.join(__dirname, '..', '..', 'config', 'vectorConfig.json');
const backupPath = cfgPath + '.bak';

describe('EmbeddingManager config integration', () => {
  const testChunk = 1234;

  beforeEach(() => {
    // Backup existing config if present
    if (fs.existsSync(cfgPath)) fs.copyFileSync(cfgPath, backupPath);

    const testCfg = {
      embeddingProvider: 'transformers',
      embeddingModel: 'Xenova/all-mpnet-base-v2',
      chunkStrategy: 'perRound',
      chunkSize: testChunk
    };

    fs.writeFileSync(cfgPath, JSON.stringify(testCfg, null, 2));
  });

  afterEach(() => {
    // Restore backup or remove test file
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, cfgPath);
      fs.unlinkSync(backupPath);
    } else {
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
    }
  });

  it('reads chunkSize from vectorConfig.json via EmbeddingManager.getDefaultChunkSize()', () => {
    const value = EmbeddingManager.getDefaultChunkSize();
    expect(value).toBe(testChunk);
  });
});
