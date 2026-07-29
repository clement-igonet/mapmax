// License-key gate for the sandbox host (#76).
//
// The sandbox (advanced/paid feature preview) asks for a Polar license key,
// validated in the browser against Polar's PUBLIC customer-portal endpoint
// (no backend of ours, R3). Valid → cached in localStorage and the app loads;
// invalid → the gate stays. This is a soft, feature-demo gate on a static
// site (source is downloadable) — it demonstrates the purchase→unlock flow,
// it is not a hard access boundary.
//
// The pure helpers (gateActive / entitlement (de)serialization / verdict) are
// unit-tested; setupLicenseGate wires the DOM + Polar fetch.
import { POLAR } from './config.js';

const LS_KEY = 'mapmax:license';
const RECHECK_MS = 7 * 24 * 3600 * 1000; // re-validate a cached key weekly

// Is this host gated? The configured sandbox host, or any host with ?sandbox=1
// (dev/e2e). Only when POLAR.enabled.
export function gateActive(hostname, search, polar = POLAR) {
  if (!polar.enabled) return false;
  if (/[?&]sandbox=1(&|$)/.test(search || '')) return true;
  return (hostname || '') === polar.gatedHost;
}

// A cached entitlement is usable until its re-check time (then re-validate).
export function entitlementUsable(record, now = Date.now()) {
  return !!(record && record.key && typeof record.expiresAt === 'number' && now < record.expiresAt);
}

export function readEntitlement(storage) {
  try { return JSON.parse(storage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
export function writeEntitlement(storage, key, now = Date.now()) {
  const record = { key, at: now, expiresAt: now + RECHECK_MS };
  try { storage.setItem(LS_KEY, JSON.stringify(record)); } catch { /* private mode */ }
  return record;
}
export function clearEntitlement(storage) {
  try { storage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// Interpret Polar's validate response into a boolean grant. 200 with an active
// status → granted; a revoked/disabled key or a 404 → not granted.
export function isGranted(status, body) {
  if (status !== 200) return false;
  const s = body && body.status;
  return s ? s === 'granted' : true;
}

// Browser: POST the key to Polar's public customer-portal validate endpoint.
export async function validateKey(key, opts = {}) {
  const apiBase = opts.apiBase || POLAR.apiBase;
  const organizationId = opts.organizationId || POLAR.organizationId;
  const fetchFn = opts.fetch || fetch;
  try {
    const res = await fetchFn(`${apiBase}/v1/customer-portal/license-keys/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: (key || '').trim(), organization_id: organizationId }),
    });
    const body = await res.json().catch(() => ({}));
    return { granted: isGranted(res.status, body), status: res.status, body };
  } catch (err) {
    return { granted: false, status: 0, error: String(err) };
  }
}

// --- DOM overlay ------------------------------------------------------------

function buildOverlay(doc, onUnlock) {
  const el = (tag, props = {}, kids = []) => {
    const n = doc.createElement(tag);
    Object.assign(n, props);
    for (const k of kids) n.append(k);
    return n;
  };
  const input = el('input', { id: 'license-key-input', type: 'text', placeholder: 'MAPMAX-XXXX-XXXX-XXXX-XXXXXXXXXXXX', autocomplete: 'off', spellcheck: false });
  const msg = el('p', { id: 'license-msg', className: 'license-msg' });
  const unlockBtn = el('button', { id: 'license-unlock', type: 'button', textContent: 'Unlock' });
  const buyBtn = el('a', { id: 'license-buy', href: POLAR.checkoutUrl || '#', target: '_blank', rel: 'noopener', textContent: 'Get sandbox access →' });

  const submit = async () => {
    msg.textContent = 'Checking…';
    msg.className = 'license-msg';
    unlockBtn.disabled = true;
    const ok = await onUnlock(input.value);
    unlockBtn.disabled = false;
    if (!ok) {
      msg.textContent = 'That key isn’t valid for this sandbox. Check it, or get access below.';
      msg.className = 'license-msg license-err';
    }
  };
  unlockBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const card = el('div', { className: 'license-card' }, [
    el('div', { className: 'license-brand', textContent: 'MapMax · Sandbox' }),
    el('h1', { textContent: 'Advanced access' }),
    el('p', { className: 'license-lead', textContent: `Enter your ${POLAR.productName} license key to unlock the sandbox — HD panoramas, custom overlays, the calibration suite and the tour builder.` }),
    el('div', { className: 'license-row' }, [input, unlockBtn]),
    msg,
    el('div', { className: 'license-sep', textContent: 'No key yet?' }),
    buyBtn,
  ]);
  const overlay = el('div', { id: 'license-gate' }, [card]);
  return overlay;
}

// Gate the app on the sandbox host. Returns true if the app may proceed
// (not gated, or already entitled). When gated & unentitled, mounts the
// overlay and returns false. `deps` is injectable for tests.
export async function setupLicenseGate(deps = {}) {
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  const loc = deps.location || (typeof location !== 'undefined' ? location : { hostname: '', search: '' });
  const storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!doc || !gateActive(loc.hostname, loc.search)) return true;

  const cached = storage && readEntitlement(storage);
  if (entitlementUsable(cached)) {
    // Revalidate in the background; revoke access if the key is no longer granted.
    validateKey(cached.key, deps).then((r) => { if (!r.granted && r.status !== 0) { clearEntitlement(storage); location.reload(); } });
    return true;
  }

  const overlay = buildOverlay(doc, async (key) => {
    const { granted } = await validateKey(key, deps);
    if (granted) {
      writeEntitlement(storage, (key || '').trim());
      overlay.remove();
      doc.body.classList.remove('license-gated');
      return true;
    }
    return false;
  });
  doc.body.classList.add('license-gated');
  doc.body.append(overlay);
  return false;
}
