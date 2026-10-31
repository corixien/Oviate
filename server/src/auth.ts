// Accounts: scrypt password hashes, opaque session tokens (only their hash is stored).
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Db } from './db.ts';

const scryptAsync = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scryptAsync(pw, salt)).toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, s, h] = stored.split('$');
  if (kind !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64'), got = await scryptAsync(pw, Buffer.from(s, 'base64'));
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface User { id: string; email: string; name: string }
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export class AuthError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function newSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1,$2,$3)', [sha(token), userId, Date.now()]);
  return token;
}

export async function register(db: Db, email: string, password: string, name?: string): Promise<{ token: string; user: User }> {
  email = String(email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AuthError(400, 'Enter a valid e-mail address');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new AuthError(400, 'The password needs at least 8 characters');
  const taken = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (taken.rows.length) throw new AuthError(409, 'This e-mail is already registered');
  const user: User = { id: randomUUID(), email, name: (String(name ?? '').trim() || email.split('@')[0]).slice(0, 40) };
  await db.query('INSERT INTO users (id, email, name, pw_hash, created_at) VALUES ($1,$2,$3,$4,$5)', [user.id, email, user.name, await hashPassword(password), Date.now()]);
  return { token: await newSession(db, user.id), user };
}

export async function login(db: Db, email: string, password: string): Promise<{ token: string; user: User }> {
  const r = await db.query<{ id: string; email: string; name: string; pw_hash: string }>('SELECT id, email, name, pw_hash FROM users WHERE email = $1', [String(email ?? '').trim().toLowerCase()]);
  const u = r.rows[0];
  // same answer for an unknown e-mail and a wrong password
  if (!u || !(await verifyPassword(String(password ?? ''), u.pw_hash))) throw new AuthError(401, 'Wrong e-mail or password');
  return { token: await newSession(db, u.id), user: { id: u.id, email: u.email, name: u.name } };
}

export async function userOf(db: Db, token: string): Promise<User | null> {
  if (!token) return null;
  const r = await db.query<User>('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', [sha(token)]);
  return r.rows[0] ?? null;
}

export async function logout(db: Db, token: string) { await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]); }
