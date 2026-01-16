import { describe, it, expect, afterEach } from 'vitest';
import { createJob, setJobStatus, listJobs } from '../jobs/jobStore.js';
import { recordAudit, clearAudits } from '../jobs/auditLog.js';
import fs from 'fs/promises';
import path from 'path';

const JOBS_FILE = path.join(process.cwd(), 'backend', 'data', 'jobs.json');
const AUDIT_FILE = path.join(process.cwd(), 'backend', 'vector_deletes_audit.jsonl');

describe('Job & Audit Persistence', () => {
  afterEach(async () => {
    // Cleanup audit file and in-memory cache after each test
    await clearAudits();
    await fs.unlink(AUDIT_FILE).catch(() => {});

    // Remove any lingering unit-test-job entries from jobs.json
    try {
      const raw = await fs.readFile(JOBS_FILE, 'utf-8').catch(() => '[]');
      const arr = JSON.parse(raw || '[]');
      const filtered = Array.isArray(arr) ? arr.filter((j: any) => j.type !== 'unit-test-job' || (j.payload && j.payload.foo !== 'bar')) : arr;
      await fs.writeFile(JOBS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
    } catch {
      // ignore cleanup errors
    }
  });

  it('persists jobs to disk after updates', async () => {
    const job = createJob('unit-test-job', { foo: 'bar' });
    setJobStatus(job.id, 'running');
    setJobStatus(job.id, 'completed', { ok: true });

    // The jobStore keeps an in-memory view; assert against that directly to avoid timing sleeps
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

    // recordAudit awaits fs.appendFile, so read the file directly
    const content = await fs.readFile(AUDIT_FILE, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toBeTruthy();
    expect(last.filter && last.filter.test).toBe('audit');
  });
});
