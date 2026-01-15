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
    const content = await fs.readFile(JOBS_FILE, 'utf-8');
    const arr = JSON.parse(content || '[]');
    if (Array.isArray(arr)) {
      for (const j of arr) {
        if (j && j.id) jobs.set(j.id, j as Job);
      }
    }
  } catch (e) {
    console.warn('[JOB_STORE] Failed to load jobs file:', e instanceof Error ? e.message : String(e));
  }
}

async function persistJobs(): Promise<void> {
  try {
    const arr = Array.from(jobs.values());
    const tmp = JOBS_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf-8');
    await fs.rename(tmp, JOBS_FILE);
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
