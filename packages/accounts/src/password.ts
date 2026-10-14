import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Passwords are hashed with salted scrypt off the main event loop (libuv pool). The policy is deliberately simple:
// a length range, not the username, not one repeated character, not one of the most common choices.

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export const LOCK_AFTER_FAILURES = 8;
export const LOCK_MS = 5 * 60 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((x) => Number.isSafeInteger(x) && x > 0) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: SCRYPT.maxmem });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Equalises timing for unknown usernames so login responses do not reveal which usernames exist. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('cursebound-timing-equaliser');
  await verifyPassword(password, await dummyHash);
}

/** Problem with a proposed password, or null when acceptable. */
export function passwordProblem(password: unknown, username: string): string | null {
  if (typeof password !== 'string') return 'password required';
  if (password.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `password must be at most ${PASSWORD_MAX} characters`;
  if (password.toLowerCase() === username.toLowerCase()) return 'password must differ from your username';
  if (/^(.)\1+$/.test(password)) return 'password cannot be one repeated character';
  if (COMMON.has(password.toLowerCase())) return 'that password is too common';
  return null;
}

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'qwerty123', 'iloveyou', 'letmein1', 'abc12345', 'baseball', 'football', 'sunshine', 'princess', 'dragon12', 'cursebound']);
