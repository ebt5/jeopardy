export interface Session {
  username: string;
}

export const SESSION_KEY = 'jeopardy-session';

/** Hardcoded host accounts for this local client-side gate. */
const USERS: Array<{ username: string; password: string }> = [
  { username: 'Erik', password: 'goose' },
  { username: 'Jon', password: 'goose' },
];

export function authenticate(username: string, password: string): Session | null {
  const trimmed = username.trim();
  if (!trimmed) return null;
  const match = USERS.find(
    (u) => u.username.toLowerCase() === trimmed.toLowerCase() && u.password === password,
  );
  if (!match) return null;
  return { username: match.username };
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.username !== 'string' || !parsed.username.trim()) return null;
    const known = USERS.find(
      (u) => u.username.toLowerCase() === parsed.username!.toLowerCase(),
    );
    if (!known) return null;
    return { username: known.username };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username: session.username }));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
