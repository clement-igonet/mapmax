// Unit tests for URL deep-link parsing/building (#54).
import { assertEquals } from 'jsr:@std/assert@1';
import { parsePic, withPic, withoutPic } from '../../src/deeplink.js';

Deno.test('parsePic: reads pic id and pv yaw/pitch', () => {
  assertEquals(parsePic('?pic=abc123&pv=120.5_-8'), { id: 'abc123', yaw: 120.5, pitch: -8 });
  assertEquals(parsePic('?pic=abc123'), { id: 'abc123' });
  assertEquals(parsePic('pic=abc123'), { id: 'abc123' }); // leading '?' optional
});

Deno.test('parsePic: no pic → null', () => {
  assertEquals(parsePic(''), null);
  assertEquals(parsePic('?foo=1'), null);
});

Deno.test('withPic: sets pic + rounded pv, preserves other params', () => {
  assertEquals(withPic('', 'id1', 120.47, -8.03), 'pic=id1&pv=120.5_-8');
  assertEquals(withPic('?foo=1', 'id1', 0, 0), 'foo=1&pic=id1&pv=0_0');
  // no look → no pv
  assertEquals(withPic('', 'id1'), 'pic=id1');
  // updating replaces, doesn't duplicate
  assertEquals(withPic('?pic=old&pv=9_9', 'new', 1, 2), 'pic=new&pv=1_2');
});

Deno.test('withoutPic: strips pic + pv, keeps the rest', () => {
  assertEquals(withoutPic('?pic=id1&pv=1_2'), '');
  assertEquals(withoutPic('?foo=1&pic=id1&pv=1_2&bar=2'), 'foo=1&bar=2');
  assertEquals(withoutPic('?foo=1'), 'foo=1');
});

Deno.test('round-trip: parse(withPic(...)) recovers the state', () => {
  const s = withPic('', 'seq-9', 200.1, 12.4);
  assertEquals(parsePic('?' + s), { id: 'seq-9', yaw: 200.1, pitch: 12.4 });
});
