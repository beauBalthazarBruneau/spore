import fs from 'fs';
import path from 'path';

const SPORE_ROOT = process.env.SPORE_ROOT ?? path.resolve(process.cwd(), '..');
const SESSION_FILE = path.join(SPORE_ROOT, 'mycel', 'session.json');

export function loadSessionId(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    return data.session_id ?? null;
  } catch {
    return null;
  }
}

export function saveSessionId(sessionId: string): void {
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ session_id: sessionId }));
}

export function clearSessionId(): void {
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ session_id: null }));
}
