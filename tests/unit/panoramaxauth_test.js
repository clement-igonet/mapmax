// Unit tests for the "Connect to Panoramax" token handshake builders (#104).
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  claimPollDelays,
  parseGeneratedToken,
  tokenGenerateRequest,
  whoAmIRequest,
  TOKEN_KEY,
} from '../../src/panoramaxauth.js';

Deno.test('tokenGenerateRequest: POST to the instance, no body/headers (simple CORS request)', () => {
  const req = tokenGenerateRequest('https://panoramax.openstreetmap.fr/api');
  assertEquals(req.url, 'https://panoramax.openstreetmap.fr/api/auth/tokens/generate?description=MapMax%20pose%20corrector');
  assertEquals(req.init, { method: 'POST' }); // no Content-Type → no preflight
  assertThrows(() => tokenGenerateRequest(''));
});

Deno.test('parseGeneratedToken: jwt + claim link (rel or ref spelling)', () => {
  const rel = parseGeneratedToken({ jwt_token: 'eyJx', links: [{ rel: 'claim', href: 'https://x/api/auth/tokens/1/claim' }] });
  assertEquals(rel, { jwt: 'eyJx', claimUrl: 'https://x/api/auth/tokens/1/claim' });
  const ref = parseGeneratedToken({ jwt_token: 'eyJy', links: [{ ref: 'claim', href: 'https://y/claim' }] });
  assertEquals(ref, { jwt: 'eyJy', claimUrl: 'https://y/claim' });
});

Deno.test('parseGeneratedToken: null on missing jwt, missing claim link, or garbage', () => {
  assertEquals(parseGeneratedToken({ links: [{ rel: 'claim', href: 'https://x' }] }), null);
  assertEquals(parseGeneratedToken({ jwt_token: 'eyJ', links: [{ rel: 'self', href: 'https://x' }] }), null);
  assertEquals(parseGeneratedToken(undefined), null);
  assertEquals(parseGeneratedToken({ jwt_token: 'eyJ', links: [{ rel: 'claim' }] }), null); // no href
});

Deno.test('whoAmIRequest: bearer-authenticated users/me probe', () => {
  const req = whoAmIRequest('https://x/api', 'eyJz');
  assertEquals(req.url, 'https://x/api/users/me');
  assertEquals(req.init.headers.Authorization, 'Bearer eyJz');
  assertThrows(() => whoAmIRequest('https://x/api', ''));
});

Deno.test('claimPollDelays: quick first, relaxed after, ~3 min total', () => {
  const d = claimPollDelays();
  assertEquals(d[0], 2000);
  assertEquals(d[d.length - 1], 5000);
  const total = d.reduce((a, b) => a + b, 0);
  assertEquals(total, 180000);
});

Deno.test('TOKEN_KEY: per home instance', () => {
  assertEquals(TOKEN_KEY('https://a/api'), 'mapmax:panoramax-token:https://a/api');
});
