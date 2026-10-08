import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

// `Algorithm` is an ambient const enum (unusable with isolatedModules); 2 = Argon2id.
const ARGON2ID = 2 as Algorithm;

/** OWASP 2024+ baseline for argon2id: m=19 MiB, t=2, p=1 (NF-04). */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// A real hash of a random secret, verified against when the user does not exist so that
// "unknown email" and "wrong password" take the same time (T13, user enumeration).
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/**
 * Opaque refresh tokens: `<row id>.<secret>`. Only SHA-256(secret) is stored. A database leak
 * yields no usable token; lookup is by id, so there is no hash index to scan.
 */
export function newOpaqueSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: sha256(secret) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function parseOpaqueToken(raw: string | undefined): { id: string; secret: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || secret.length < 32) return null;
  return { id, secret };
}
