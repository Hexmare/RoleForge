import { describe, it, expect } from 'vitest';
import { ConfigManager } from '../configManager';

describe('vector config integration', () => {
  it('logs vector config on server start', () => {
    const cfg = new ConfigManager();
    const vector = cfg.getVectorConfig();
    console.log('[INTEGRATION TEST] vectorConfig:', JSON.stringify(vector, null, 2));
    expect(vector).toBeDefined();
  });
});
