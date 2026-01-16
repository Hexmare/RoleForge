import fs from 'fs/promises';
import path from 'path';

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface Job {
  id: string;
  type: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  payload?: Record<string, any>;
  result?: any;
  error?: string;
}

const JOBS_FILE = path.join(process.cwd(), 'backend', 'data', 'jobs.json');
const jobs = new Map<string, Job>();

function now() {
  return Date.now();
}

async function ensureJobsFile(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(JOBS_FILE), { recursive: true });
    // If file doesn't exist, create an empty array
    try {
      await fs.stat(JOBS_FILE);
    } catch {
      await fs.writeFile(JOBS_FILE, '[]', 'utf-8');
    }
  } catch (e) {
    console.warn('[JOB_STORE] Failed to ensure jobs file:', e instanceof Error ? e.message : String(e));
  }
}

async function loadJobs(): Promise<void> {
  try {
    await ensureJobsFile();
    let content = await fs.readFile(JOBS_FILE, 'utf-8');
    // Sanitize: if file appears malformed, back it up and replace with []
    try {
      const arr = JSON.parse(content || '[]');
      if (Array.isArray(arr)) {
        for (const j of arr) {
          if (j && j.id) jobs.set(j.id, j as Job);
        }
        return;
      }
      // If parsed value isn't an array, treat as corruption
      throw new Error('jobs.json content is not an array');
    } catch (parseErr) {
      try {
        const bakPath = JOBS_FILE + '.corrupt.' + Date.now();
        await fs.writeFile(bakPath, content, 'utf-8');
        console.warn(`[JOB_STORE] jobs.json was malformed; backed up to ${bakPath} and recreating empty jobs file`);
      } catch (bakErr) {
        console.warn('[JOB_STORE] Failed to backup malformed jobs.json:', bakErr instanceof Error ? bakErr.message : String(bakErr));
      }
      // Replace with a fresh empty array
      content = '[]';
      try {
        await fs.writeFile(JOBS_FILE, content, 'utf-8');
      } catch (writeErr) {
        console.warn('[JOB_STORE] Failed to recreate jobs.json after backup:', writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
      return;
    }
  } catch (e) {
    console.warn('[JOB_STORE] Failed to load jobs file:', e instanceof Error ? e.message : String(e));
  }
}

// Allow tests or maintenance code to force a reload/rescan of the jobs file.
export async function reloadJobs(): Promise<void> {
  jobs.clear();
  await loadJobs();
}

/**
 * Sanitize an arbitrary jobs file path: if the file is malformed, back it up
 * and replace with an empty array. This is useful for tests to exercise the
 * sanitizer without interfering with the module-global jobs file.
 */
export async function sanitizeJobsFile(filePath: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(content || '[]');
      if (!Array.isArray(parsed)) throw new Error('not-array');
      // valid - nothing to do
      return;
    } catch (parseErr) {
      try {
        const bakPath = filePath + '.corrupt.' + Date.now();
        await fs.writeFile(bakPath, content, 'utf-8');
        console.warn(`[JOB_STORE] ${filePath} was malformed; backed up to ${bakPath} and recreating empty jobs file`);
      } catch (bakErr) {
        console.warn('[JOB_STORE] Failed to backup malformed jobs file:', bakErr instanceof Error ? bakErr.message : String(bakErr));
      }
      try {
        await fs.writeFile(filePath, '[]', 'utf-8');
      } catch (writeErr) {
        console.warn('[JOB_STORE] Failed to recreate jobs file after backup:', writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
    }
  } catch (e) {
    // If the file doesn't exist, ensure parent dir exists and create an empty file
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '[]', 'utf-8');
    } catch (ee) {
      console.warn('[JOB_STORE] sanitizeJobsFile failed:', ee instanceof Error ? ee.message : String(ee));
    }
  }
}

async function persistJobs(): Promise<void> {
  // Serialize writes using a promise chain to avoid concurrent writers
  try {
    // @ts-ignore - maintained across module scope
    persistJobs.writeChain = (persistJobs.writeChain || Promise.resolve()).then(async () => {
      const arr = Array.from(jobs.values());
      const tmp = JOBS_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf-8');
      await fs.rename(tmp, JOBS_FILE);
    }).catch((e: any) => {
      console.warn('[JOB_STORE] Failed to persist jobs file (async):', e instanceof Error ? e.message : String(e));
    });
    // Return the current writeChain so callers can await if desired
    // @ts-ignore
    return persistJobs.writeChain as Promise<void>;
  } catch (e) {
    console.warn('[JOB_STORE] Failed to persist jobs file:', e instanceof Error ? e.message : String(e));
  }
}

// Load existing jobs at startup (fire-and-forget)
loadJobs().catch(() => {});

export function createJob(type: string, payload?: Record<string, any>): Job {
  const id = `${type}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    type,
    createdAt: now(),
    updatedAt: now(),
    status: 'pending',
    payload
  };
  jobs.set(id, job);
  // Persist asynchronously
  void persistJobs();
  return job;
}

export function setJobStatus(id: string, status: Job['status'], result?: any, error?: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.updatedAt = now();
  if (result !== undefined) job.result = result;
  if (error) job.error = error;
  jobs.set(id, job);
  void persistJobs();
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export default {
  createJob,
  setJobStatus,
  getJob,
  listJobs
};
