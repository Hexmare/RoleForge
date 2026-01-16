import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const JOBS_DIR = path.join(process.cwd(), 'backend', 'data');
const JOBS_FILE = path.join(JOBS_DIR, 'jobs.json');

describe('jobs.json corruption sanitizer', () => {
  it('backs up malformed jobs.json and recreates empty file', async () => {
    // Ensure data dir exists
    await fs.mkdir(JOBS_DIR, { recursive: true });

    // Use a test-specific jobs file to avoid races with other tests that may
    // persist to the module-global jobs.json concurrently.
    const TEST_FILE = path.join(JOBS_DIR, 'jobs.test.corrupt.json');
    await fs.writeFile(TEST_FILE, '{ this is : not valid json', 'utf-8');

    // Import sanitizer helper and run it against the test file
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = await import('../jobs/jobStore.js');
    if (store && typeof store.sanitizeJobsFile === 'function') {
      await store.sanitizeJobsFile(TEST_FILE);
    }

    // Verify TEST_FILE is now a valid JSON array
    const content = await fs.readFile(TEST_FILE, 'utf-8');
    expect(content.trim()).toBe('[]');

    // Verify a backup file exists for the test file
    const files = await fs.readdir(JOBS_DIR);
    const corrupt = files.find((f) => f.startsWith('jobs.test.corrupt.json.corrupt.'));
    expect(corrupt).toBeDefined();

    // Cleanup test artifacts
    await fs.unlink(TEST_FILE).catch(() => {});
    if (corrupt) {
      await fs.unlink(path.join(JOBS_DIR, corrupt)).catch(() => {});
    }
  });
});
