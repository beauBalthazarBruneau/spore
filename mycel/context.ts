import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const SPORE_ROOT = process.env.SPORE_ROOT ?? path.resolve(process.cwd(), '..');

export function buildSessionContext(): string {
  const lines: string[] = ['[Session context — injected at start]'];

  try {
    const db = new Database(path.join(SPORE_ROOT, 'data', 'autoapply.db'), { readonly: true });

    try {
      const profile = db
        .prepare(`SELECT full_name, location FROM profile WHERE id = 1`)
        .get() as { full_name: string | null; location: string | null } | undefined;

      if (profile?.full_name) {
        lines.push(`User: ${profile.full_name}${profile.location ? ` (${profile.location})` : ''}`);
      }

      const counts = db
        .prepare(`SELECT status, COUNT(*) AS count FROM jobs GROUP BY status ORDER BY count DESC`)
        .all() as { status: string; count: number }[];

      if (counts.length > 0) {
        lines.push('\nPipeline:');
        for (const { status, count } of counts) {
          lines.push(`  ${status}: ${count}`);
        }
      } else {
        lines.push('\nPipeline: no jobs yet');
      }

      const events = db
        .prepare(
          `SELECT e.action, e.actor, e.created_at, j.title AS job_title, c.name AS company_name
             FROM events e
             LEFT JOIN jobs j ON e.entity_type = 'job' AND e.entity_id = j.id
             LEFT JOIN companies c ON j.company_id = c.id
            ORDER BY e.created_at DESC LIMIT 5`,
        )
        .all() as { action: string; actor: string; created_at: string; job_title: string | null; company_name: string | null }[];

      if (events.length > 0) {
        lines.push('\nRecent activity:');
        for (const e of events) {
          const target = e.job_title ? ` "${e.job_title}"${e.company_name ? ` @ ${e.company_name}` : ''}` : '';
          lines.push(`  ${e.created_at.slice(0, 16)} ${e.actor} — ${e.action}${target}`);
        }
      }
    } finally {
      db.close();
    }
  } catch {
    lines.push('(pipeline data unavailable)');
  }

  const memoryPath = path.join(SPORE_ROOT, 'mycel', 'memory', 'notes.md');
  try {
    const notes = fs.readFileSync(memoryPath, 'utf-8').trim();
    if (notes) {
      lines.push('\nMemory from previous sessions:');
      lines.push(notes);
    }
  } catch {
    // no memory file yet — fine
  }

  return lines.join('\n');
}
