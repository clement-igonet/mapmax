// Unit tests for the sandbox license gate (#76).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  entitlementUsable, gateActive, isGranted, readEntitlement, validateKey, writeEntitlement,
} from '../../src/licensegate.js';

const P = { enabled: true, gatedHost: 'sandbox.mapmax.confinia.io', apiBase: 'https://x', organizationId: 'org-1' };

Deno.test('gateActive: sandbox host and ?sandbox=1 gate; www does not; disabled never', () => {
  assertEquals(gateActive('sandbox.mapmax.confinia.io', '', P), true);
  assertEquals(gateActive('www.mapmax.confinia.io', '', P), false);
  assertEquals(gateActive('localhost', '?sandbox=1', P), true);
  assertEquals(gateActive('localhost', '?foo=1', P), false);
  assertEquals(gateActive('sandbox.mapmax.confinia.io', '', { ...P, enabled: false }), false);
});

Deno.test('entitlementUsable: valid until expiry', () => {
  assert(entitlementUsable({ key: 'K', expiresAt: 100 }, 50));
  assert(!entitlementUsable({ key: 'K', expiresAt: 100 }, 150));
  assert(!entitlementUsable({ key: 'K' }, 50));
  assert(!entitlementUsable(null));
});

Deno.test('isGranted: 200 granted → true; other statuses / 404 → false', () => {
  assertEquals(isGranted(200, { status: 'granted' }), true);
  assertEquals(isGranted(200, {}), true); // 200 with no status field
  assertEquals(isGranted(200, { status: 'revoked' }), false);
  assertEquals(isGranted(404, { error: 'ResourceNotFound' }), false);
});

Deno.test('read/writeEntitlement round-trip through a fake storage', () => {
  const store = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();
  assertEquals(readEntitlement(store), null);
  const rec = writeEntitlement(store, 'MAPMAX-KEY', 1000);
  assertEquals(rec.key, 'MAPMAX-KEY');
  assert(rec.expiresAt > 1000);
  assertEquals(readEntitlement(store).key, 'MAPMAX-KEY');
});

Deno.test('validateKey: posts the right body and maps the real 200/404 shapes (#76)', async () => {
  const calls = [];
  const fakeFetch = (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const key = JSON.parse(init.body).key;
    return Promise.resolve(key === 'GOOD'
      ? { status: 200, json: () => Promise.resolve({ id: 'lk', status: 'granted' }) }
      : { status: 404, json: () => Promise.resolve({ error: 'ResourceNotFound' }) });
  };
  const good = await validateKey('  GOOD  ', { apiBase: 'https://x', organizationId: 'org-1', fetch: fakeFetch });
  assertEquals(good.granted, true);
  assertEquals(calls[0].url, 'https://x/v1/customer-portal/license-keys/validate');
  assertEquals(calls[0].body, { key: 'GOOD', organization_id: 'org-1' }); // trimmed + org id
  const bad = await validateKey('NOPE', { apiBase: 'https://x', organizationId: 'org-1', fetch: fakeFetch });
  assertEquals(bad.granted, false);
  assertEquals(bad.status, 404);
});

Deno.test('validateKey: network error → not granted, no throw', async () => {
  const r = await validateKey('K', { apiBase: 'https://x', organizationId: 'o', fetch: () => Promise.reject(new Error('offline')) });
  assertEquals(r.granted, false);
  assertEquals(r.status, 0);
});
