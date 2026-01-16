import { describe, it, expect } from 'vitest';
import { scheduleBackgroundJob, appendAuditEntry } from '../utils/jobHelpers';
import { getJob } from '../jobs/jobStore';
import { listAudits, clearAudits } from '../jobs/auditLog';

function waitForCondition(fn: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (fn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(poll, 20);
    })();
  });
}

describe('jobHelpers', () => {
  it('schedules a background job and sets status to completed on success', async () => {
    const runner = async () => {
      return { ok: true, value: 42 };
    };

    const job = scheduleBackgroundJob('testJob', { foo: 'bar' }, runner);
    expect(job).toHaveProperty('id');

    // initially the job may be pending/running; wait for completion
    await waitForCondition(() => {
      const j = getJob(job.id);
      return j !== undefined && j.status === 'completed';
    }, 2000);

    const final = getJob(job.id)!;
    expect(final.status).toBe('completed');
    expect(final.result).toBeTruthy();
  });

  it('appendAuditEntry writes to audit log (in-memory cache)', async () => {
    await clearAudits();
    const entry = { timestamp: new Date().toISOString(), filter: { a: 1 }, scopes: ['s1'], deletedCount: 1 };
    await appendAuditEntry(entry as any);
    const list = listAudits();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find(x => x.filter && x.filter.a === 1);
    expect(found).toBeTruthy();
  });
});
