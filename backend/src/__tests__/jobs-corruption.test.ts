import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const JOBS_DIR = path.join(process.cwd(), 'backend', 'data');
const JOBS_FILE = path.join(JOBS_DIR, 'jobs.json');

describe('jobs.json corruption sanitizer', () => {
  it('backs up malformed jobs.json and recreates empty file', async () => {
    // Ensure data dir exists
    await fs.mkdir(JOBS_DIR, { recursive: true });

    // Write malformed content
    await fs.writeFile(JOBS_FILE, '{ this is : not valid json', 'utf-8');

    // Import jobStore to trigger loadJobs (dynamic import to ensure fresh module)
    // Use same relative path as other tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await import('../jobs/jobStore.js');

    // Give a small delay for any async operations
    await new Promise((r) => setTimeout(r, 200));

    // Verify jobs.json is now a valid JSON array
    const content = await fs.readFile(JOBS_FILE, 'utf-8');
    expect(content.trim()).toBe('[]');

    // Verify a backup file exists (jobs.json.corrupt.*)
    const files = await fs.readdir(JOBS_DIR);
    const corrupt = files.find((f) => f.startsWith('jobs.json.corrupt.'));
    expect(corrupt).toBeDefined();
  });
});
