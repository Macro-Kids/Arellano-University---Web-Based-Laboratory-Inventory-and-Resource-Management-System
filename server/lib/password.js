// -----------------------------------------------------------------------------
// password.js — scrypt hashing (built into Node, no native deps). SR-001.
// Stored format: scrypt$N$r$p$saltB64$hashB64
// -----------------------------------------------------------------------------
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 16384, r = 8, p = 1, KEYLEN = 64;

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function hashPasswordSync(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(plain, stored) {
  try {
    const [scheme, n, rr, pp, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, { N: +n, r: +rr, p: +pp });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

/** RA-003: minimum password quality. Returns an error message or null. */
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password must be 128 characters or fewer.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}
/** Readable temporary password, e.g. "Kf7-mQ2x-Rp9w". */
export function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = () => alphabet[crypto.randomInt(alphabet.length)];
  const chunk = (n) => Array.from({ length: n }, pick).join('');
  return `${chunk(4)}-${chunk(4)}-${chunk(4)}${crypto.randomInt(10)}`;
}
