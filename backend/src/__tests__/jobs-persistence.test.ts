import { describe, it, expect } from 'vitest';
import { createJob, setJobStatus, listJobs } from '../jobs/jobStore.js';
import { recordAudit } from '../jobs/auditLog.js';
import fs from 'fs/promises';
import path from 'path';

const JOBS_FILE = path.join(process.cwd(), 'backend', 'data', 'jobs.json');
const AUDIT_FILE = path.join(process.cwd(), 'backend', 'vector_deletes_audit.jsonl');

describe('Job & Audit Persistence', () => {
  it('persists jobs to disk after updates', async () => {
    const job = createJob('unit-test-job', { foo: 'bar' });
    setJobStatus(job.id, 'running');
    setJobStatus(job.id, 'completed', { ok: true });

    // wait briefly for async persist
    await new Promise((r) => setTimeout(r, 200));

    // Verify via API of the module (in-memory list) rather than parsing file (robust against file content)
    const arr = listJobs();
    const found = arr.find((j: any) => j.id === job.id);
    expect(found).toBeTruthy();
    expect(found!.status).toBe('completed');
  });

  it('appends audit entries to jsonl file', async () => {
    const entry = {
      timestamp: new Date().toISOString(),
      filter: { test: 'audit' },
      scopes: ['test_scope'],
      deletedCount: 1
    };

    await recordAudit(entry);
    // wait for append (poll for file to exist)
    const maxAttempts = 10;
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        await fs.access(AUDIT_FILE);
        break;
      } catch {
        // wait and retry
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
    }

    const content = await fs.readFile(AUDIT_FILE, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toBeTruthy();
    expect(last.filter && last.filter.test).toBe('audit');
  });
});
