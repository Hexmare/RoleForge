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

const jobs = new Map<string, Job>();

function now() {
  return Date.now();
}

export function createJob(type: string, payload?: Record<string, any>): Job {
  const id = `${type}-${now()}-${Math.random().toString(36).slice(2,8)}`;
  const job: Job = {
    id,
    type,
    createdAt: now(),
    updatedAt: now(),
    status: 'pending',
    payload
  };
  jobs.set(id, job);
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
