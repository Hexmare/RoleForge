import { createJob, setJobStatus } from '../jobs/jobStore.js';
import { recordAudit } from '../jobs/auditLog.js';

export function safeSetJobStatus(id: string, status: string, result?: any, error?: string) {
  try {
    setJobStatus(id, status as any, result, error);
  } catch (e) {
    console.warn('[JOB_HELPERS] Failed to set job status', { id, status, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function appendAuditEntry(entry: any) {
  try {
    await recordAudit(entry);
  } catch (e) {
    console.warn('[JOB_HELPERS] Failed to write audit entry', e instanceof Error ? e.message : String(e));
  }
}

export function scheduleBackgroundJob(type: string, payload: Record<string, any> | undefined, runner: () => Promise<any>): any {
  const job = createJob(type, payload || {});
  try {
    setJobStatus(job.id, 'running');
  } catch (e) {
    console.warn('[JOB_HELPERS] Failed to mark job running', e instanceof Error ? e.message : String(e));
  }

  runner()
    .then((res) => {
      try {
        setJobStatus(job.id, 'completed', res);
      } catch (e) {
        console.warn('[JOB_HELPERS] Failed to set job completed', e instanceof Error ? e.message : String(e));
      }
    })
    .catch((err) => {
      try {
        setJobStatus(job.id, 'failed', undefined, err instanceof Error ? err.message : String(err));
      } catch (e) {
        console.warn('[JOB_HELPERS] Failed to set job failed', e instanceof Error ? e.message : String(e));
      }
      console.error('[JOB_HELPERS] background job error', err);
    });

  return job;
}

export default { safeSetJobStatus, appendAuditEntry, scheduleBackgroundJob };
