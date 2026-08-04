// "Connect to Panoramax" (#104) — pure builders/parsers for the token
// generate → claim → poll flow, so the whole handshake is unit-tested offline.
//
// Flow (front-end only, R3): POST /auth/tokens/generate (no auth, no body — a
// CORS "simple request", no preflight) returns a JWT plus a `claim` link; the
// claim URL is opened in a new tab where the instance runs its OAuth dance
// (OpenStreetMap login) and binds the token to the user's account. Until then
// the JWT is unusable, so the app polls GET /users/me with it: 401/403 =
// not claimed yet, 200 = connected (and identifies the account).

export function tokenGenerateRequest(apiBase) {
  if (!apiBase) throw new Error('tokenGenerateRequest: apiBase is required');
  return {
    url: `${apiBase}/auth/tokens/generate?description=${encodeURIComponent('MapMax pose corrector')}`,
    init: { method: 'POST' },
  };
}

// The generate response: { jwt_token, links: [{ href, rel|ref }] }. The
// OpenAPI schema names the link-relation key `ref` while the docs say `rel` —
// accept both. null when the response has no usable jwt + claim link.
export function parseGeneratedToken(data) {
  const jwt = typeof data?.jwt_token === 'string' && data.jwt_token ? data.jwt_token : null;
  const claim = (data?.links || []).find(
    (l) => l && (l.rel === 'claim' || l.ref === 'claim') && typeof l.href === 'string'
  );
  return jwt && claim ? { jwt, claimUrl: claim.href } : null;
}

export function whoAmIRequest(apiBase, jwt) {
  if (!apiBase || !jwt) throw new Error('whoAmIRequest: apiBase and jwt are required');
  return {
    url: `${apiBase}/users/me`,
    init: { headers: { Authorization: `Bearer ${jwt}` } },
  };
}

// Poll cadence while the user signs in over in the claim tab: quick at first
// (most sign-ins take seconds), then relaxed — ~3 minutes total before giving up.
export function claimPollDelays() {
  const delays = [];
  for (let i = 0; i < 10; i++) delays.push(2000);   // 20 s of quick checks
  for (let i = 0; i < 32; i++) delays.push(5000);   // then every 5 s
  return delays;                                     // ≈ 180 s total
}

// Session-only token storage, keyed per home instance — a Panoramax token is
// only valid on the instance that issued it (#98 resolves homeApi per picture).
export const TOKEN_KEY = (apiBase) => `mapmax:panoramax-token:${apiBase}`;
