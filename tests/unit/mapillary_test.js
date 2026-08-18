// Unit tests for the Mapillary adapter (#112 phase 2) — pure parts only, no
// network: Graph-node normalization, bbox maths, batch reordering, token
// resolution, and the adapter contract against the sources registry.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  bboxAround,
  mapillarySource,
  normalizeImage,
  orderLike,
  resolveToken,
} from '../../src/mapillary.js';
import { _resetSources, isEditable, registerSource, sourceOf } from '../../src/sources.js';

// A representative Graph API v4 pano node (fields= response shape).
const panoNode = {
  id: 1234567890123456,
  geometry: { type: 'Point', coordinates: [2.35, 48.85] },
  computed_geometry: { type: 'Point', coordinates: [2.350012, 48.850009] },
  compass_angle: 181.5,
  computed_compass_angle: 184.2,
  is_pano: true,
  thumb_1024_url: 'https://cdn.example/1024.jpg?sig=t',
  thumb_2048_url: 'https://cdn.example/2048.jpg?sig=t',
  thumb_original_url: 'https://cdn.example/orig.jpg?sig=t',
  sequence: 'seq_abc',
  captured_at: 1712345678901,
  creator: { username: 'contributor42', id: 987 },
};

Deno.test('normalizeImage: pano node → normalized 360° picture', () => {
  const pic = normalizeImage(panoNode);
  assertEquals(pic.id, '1234567890123456'); // numeric ids become strings
  assertEquals(pic.source, 'mapillary');
  assertEquals(pic.type, 'equirectangular');
  assertEquals(pic.hfov, 360);
  assertEquals(pic.lon, 2.350012); // SfM-computed geometry preferred
  assertEquals(pic.heading, 184.2); // computed compass preferred
  assert(pic.hasCompass);
  assertEquals(pic.sequenceId, 'seq_abc');
  assertEquals(pic.assets.hd, panoNode.thumb_original_url);
  assertEquals(pic.assets.sd, panoNode.thumb_2048_url);
  assertEquals(pic.assets.thumb, panoNode.thumb_1024_url);
  assertEquals(pic.producer, 'contributor42');
  assertEquals(pic.license, 'CC-BY-SA-4.0');
  assertEquals(pic.datetime, new Date(1712345678901).toISOString());
  assertEquals(pic.tiles, null); // no tiled derivates: single-texture path
  assertEquals(pic.homeApi, null); // read-only source
});

Deno.test('normalizeImage: flat node + missing computed fields fall back', () => {
  const pic = normalizeImage({
    id: '77',
    geometry: { type: 'Point', coordinates: [1.1, 2.2] },
    compass_angle: 90,
    is_pano: false,
  });
  assertEquals(pic.type, 'flat');
  assertEquals(pic.hfov, 70);
  assertEquals(pic.lon, 1.1); // raw geometry when no computed_geometry
  assertEquals(pic.heading, 90); // camera compass when no computed angle
  const bare = normalizeImage({ id: '78', geometry: { coordinates: [0, 0] } });
  assertEquals(bare.heading, 0);
  assert(!bare.hasCompass);
  assertEquals(bare.datetime, undefined);
});

Deno.test('bboxAround: metres → degree box, widened by latitude', () => {
  const [minLon, minLat, maxLon, maxLat] = bboxAround(2.35, 48.85, 30);
  const dLat = (maxLat - minLat) / 2;
  const dLon = (maxLon - minLon) / 2;
  assert(Math.abs(dLat - 30 / 111320) < 1e-12);
  assert(dLon > dLat); // 1° of longitude shrinks with cos(lat)
  assert(Math.abs(dLon - dLat / Math.cos((48.85 * Math.PI) / 180)) < 1e-12);
});

Deno.test('orderLike: batch results reordered to the sequence, ranks stamped', () => {
  const nodes = [{ id: 'c' }, { id: 'a' }, { id: 3 }];
  const ordered = orderLike(['a', '3', 'missing', 'c'], nodes);
  assertEquals(ordered.map((n) => String(n.id)), ['a', '3', 'c']);
  assertEquals(ordered.map((n) => n.rankInSequence), [0, 1, 3]); // gap kept
});

Deno.test('resolveToken: url param > stored > configured', () => {
  assertEquals(resolveToken({ urlParam: 'u', stored: 's', configured: 'c' }), 'u');
  assertEquals(resolveToken({ stored: 's', configured: 'c' }), 's');
  assertEquals(resolveToken({ configured: 'c' }), 'c');
  assertEquals(resolveToken({}), '');
});

Deno.test('mapillarySource: satisfies the registry contract; locally adjustable', () => {
  _resetSources();
  registerSource(mapillarySource); // throws if the contract is not met
  assertEquals(mapillarySource.capabilities, { editable: true, hdTiles: false, sequences: true });
  assertEquals(mapillarySource.layers.length, 2); // legend toggle targets (#112)
  assert(mapillarySource.color); // legend chip color, distinct from Panoramax
  const pic = normalizeImage(panoNode);
  assertEquals(sourceOf(pic).id, 'mapillary');
  assert(isEditable(pic)); // 🔧 Adjust arms: local corrections work for any source (#111)
  _resetSources();
});
