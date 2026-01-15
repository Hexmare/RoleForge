import fs from 'fs/promises';
import path from 'path';

const AUDIT_FILE = path.join(process.cwd(), 'backend', 'vector_deletes_audit.jsonl');

interface AuditEntry {
  timestamp: string;
  filter: Record<string, any>;
  scopes: string[];
  deletedCount: number;
  deletedIds?: string[];
  actor?: string;
}

const cache: AuditEntry[] = [];

export async function recordAudit(entry: AuditEntry): Promise<void> {
  cache.push(entry);
  try {
    const line = JSON.stringify(entry) + '\n';
    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    await fs.appendFile(AUDIT_FILE, line, 'utf-8');
  } catch (e) {
    // Non-fatal: keep in-memory cache
    // eslint-disable-next-line no-console
    console.warn('[AUDIT] Failed to persist audit entry:', e instanceof Error ? e.message : String(e));
  }
}

export function listAudits(): AuditEntry[] {
  return Array.from(cache);
}

export async function clearAudits(): Promise<void> {
  cache.length = 0;
  try {
    await fs.unlink(AUDIT_FILE).catch(() => {});
  } catch {}
}

export default { recordAudit, listAudits, clearAudits };
