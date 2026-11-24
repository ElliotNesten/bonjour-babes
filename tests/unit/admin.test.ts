import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/backend', async () => {
  const types = await vi.importActual<typeof import('../../src/lib/backend/types')>('../../src/lib/backend/types');
  const { createFakeBackend } = await import('./fakeBackend');
  return { ...types, backend: createFakeBackend(), isDemoMode: true };
});

import { backend } from '../../src/lib/backend';
import { PASSWORD_MIN, adminLogin, adminLogout, hashPassword, isAdminConfigured, setupAdminPassword } from '../../src/lib/admin';
import type { FakeBackend } from './fakeBackend';

const db = backend as unknown as FakeBackend;
const SALT = 'bonjour-babes:v1:';
const expected = (password: string) => createHash('sha256').update(SALT + password, 'utf8').digest('hex');

// Saltet är 17 byte. 38/39 tecken ger 55/56 byte (gränsen för ett SHA-256-block), 47 ger exakt 64.
const SAMPLES = ['', 'santé', 'a'.repeat(38), 'a'.repeat(39), 'a'.repeat(47), 'a'.repeat(48), 'x'.repeat(300), '🥂 Bonjour Babes 🍸'];

describe('hashPassword', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('är SHA-256 (hex) av salt + lösenord', async () => {
    for (const pw of SAMPLES) {
      const hash = await hashPassword(pw);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(expected(pw));
    }
  });

  it('ger samma hash utan crypto.subtle (t.ex. http på LAN)', async () => {
    vi.stubGlobal('crypto', {});
    expect(globalThis.crypto.subtle).toBeUndefined();
    for (const pw of SAMPLES) expect(await hashPassword(pw)).toBe(expected(pw));
  });
});

describe('adminlösenord (demoläge)', () => {
  beforeEach(() => db.reset());

  it('kräver ett tillräckligt långt lösenord', async () => {
    await expect(setupAdminPassword('a'.repeat(PASSWORD_MIN - 1))).rejects.toThrow(/minst/);
    expect(await isAdminConfigured()).toBe(false);
  });

  it('sparar hashen, sätter flaggan och loggar in', async () => {
    await setupAdminPassword('santé');
    const data = db.data() as { secret: { adminHash: string }; setup: { adminConfigured: boolean }; adminSessions: Record<string, string> };
    expect(data.secret.adminHash).toBe(expected('santé'));
    expect(data.setup.adminConfigured).toBe(true);
    expect(data.adminSessions.admin).toBe(expected('santé'));
    expect(await isAdminConfigured()).toBe(true);
  });

  it('loggar bara in med rätt lösenord och kan logga ut', async () => {
    await setupAdminPassword('santé');
    db.setUid('mobil-2');
    expect(await adminLogin('fel')).toBe(false);
    expect((db.data().adminSessions as Record<string, string>)['mobil-2']).toBeUndefined();
    expect(await adminLogin('santé')).toBe(true);
    expect((db.data().adminSessions as Record<string, string>)['mobil-2']).toBe(expected('santé'));
    await adminLogout();
    expect((db.data().adminSessions as Record<string, string>)['mobil-2']).toBeUndefined();
  });
});
