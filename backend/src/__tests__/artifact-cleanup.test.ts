import { afterAll, describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function removeByPrefixes(baseDir: string, prefixes: string[]): Promise<void> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (prefixes.some((p) => entry.name.startsWith(p))) {
        await fs.rm(path.join(baseDir, entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

describe('test artifact cleanup', () => {
  afterAll(async () => {
    const cwd = process.cwd();
    await removeByPrefixes(cwd, [
      'vector_test_tmp',
      'vector_test_tmp_delete',
      'vector_data_test',
      'vector_test_tmp_audit',
      'vector_test_tmp_delete_global',
      'vector_test_tmp_delete_safety'
    ]);
    const vectorData = path.join(cwd, 'vector_data');
    await removeByPrefixes(vectorData, ['world_999']);

    // Temp dirs created during tests (e.g., rf-json-*)
    await removeByPrefixes(os.tmpdir(), ['rf-json-']);
  });

  it('cleans up artifacts after suite', () => {
    expect(true).toBe(true);
  });
});
