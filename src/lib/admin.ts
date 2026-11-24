import { useEffect, useState } from 'react';
import { backend, isPermissionDenied } from './backend';

/**
 * Adminlösenord utan e-postkonto:
 *  - Första gången väljer admin ett lösenord. Dess SHA-256 sparas i secret/adminHash,
 *    som ingen klient kan läsa (se database.rules.json).
 *  - Inloggning = skriva hashen till adminSessions/{uid}. Reglerna godkänner bara
 *    skrivningen om hashen matchar, och alla admin-skrivningar kräver en giltig session.
 *  - Byta/återställa lösenordet: radera noden "secret" (och "setup") i Firebase Console.
 */

const SALT = 'bonjour-babes:v1:';

/* --- SHA-256 (fallback för osäkra kontexter där crypto.subtle saknas, t.ex. http på LAN) --- */
function sha256Fallback(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  const message = SALT + password;
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(message);
}

export const PASSWORD_MIN = 8;

/** Har adminlösenordet valts? */
export async function isAdminConfigured(): Promise<boolean> {
  return (await backend.get<boolean>('setup/adminConfigured')) === true;
}

/** Första gången: välj adminlösenord och logga in. */
export async function setupAdminPassword(password: string): Promise<void> {
  if (password.length < PASSWORD_MIN) throw new Error(`Lösenordet måste vara minst ${PASSWORD_MIN} tecken`);
  const hash = await hashPassword(password);
  try {
    await backend.update('', { 'secret/adminHash': hash, 'setup/adminConfigured': true });
  } catch (err) {
    if (isPermissionDenied(err)) throw new Error('Ett adminlösenord är redan valt. Logga in i stället.');
    throw err;
  }
  const ok = await adminLogin(password);
  if (!ok) throw new Error('Lösenordet sparades men inloggningen misslyckades – försök logga in.');
}

/** Logga in som admin. Returnerar false vid fel lösenord. */
export async function adminLogin(password: string): Promise<boolean> {
  const uid = backend.uid() ?? (await backend.ready());
  const hash = await hashPassword(password);
  if (backend.kind === 'local') {
    // Demoläget har inga säkerhetsregler – jämför själv.
    const stored = await backend.get<string>('secret/adminHash');
    if (stored !== hash) return false;
  }
  try {
    await backend.set(`adminSessions/${uid}`, hash);
    return true;
  } catch (err) {
    if (isPermissionDenied(err)) return false;
    throw err;
  }
}

export async function adminLogout(): Promise<void> {
  const uid = backend.uid();
  if (uid) await backend.remove(`adminSessions/${uid}`);
}

/** Är den här enheten inloggad som admin? undefined = laddar. */
export function useIsAdmin(): boolean | undefined {
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const uid = backend.uid();
    if (!uid) {
      setIsAdmin(false);
      return;
    }
    return backend.subscribe<string>(
      `adminSessions/${uid}`,
      (v) => setIsAdmin(typeof v === 'string' && v.length > 0),
      () => setIsAdmin(false),
    );
  }, []);
  return isAdmin;
}
