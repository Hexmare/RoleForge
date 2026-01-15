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

async function loadExisting(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    const content = await fs.readFile(AUDIT_FILE, 'utf-8').catch(() => '');
    if (!content) return;
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        cache.push(parsed as AuditEntry);
      } catch {
        // skip malformed
      }
    }
  } catch (e) {
    console.warn('[AUDIT] Failed to load existing audit file:', e instanceof Error ? e.message : String(e));
  }
}

// Load at startup
void loadExisting();

export async function recordAudit(entry: AuditEntry): Promise<void> {
  cache.push(entry);
  try {
    const line = JSON.stringify(entry) + '\n';
    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    await fs.appendFile(AUDIT_FILE, line, 'utf-8');
  } catch (e) {
    // Non-fatal: keep in-memory cache
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
