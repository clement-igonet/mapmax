// Unit tests for the Panoramax STAC client normalization (issue #2).
import { assertEquals } from 'jsr:@std/assert@1';
import { idFromHref, normalizeItem } from '../../src/panoramax.js';

const fixture = JSON.parse(
  await Deno.readTextFile(new URL('../fixtures/stac-item.json', import.meta.url))
);

Deno.test('normalizeItem: real STAC item from api.panoramax.xyz', () => {
  const pic = normalizeItem(fixture);
  assertEquals(pic.id, '5914cdbb-36a9-4e91-8527-fbebcf96d8d4');
  assertEquals(pic.sequenceId, 'fe73d2db-1697-484c-8d10-ced87f97f1cf');
  assertEquals(pic.heading, 208);
  assertEquals(pic.type, 'flat'); // Fairphone FP3, portrait sensor
  assertEquals(pic.nextId, '41340b58-c2ad-47b5-ad26-006495ff0210');
  assertEquals(pic.prevId, null);
  assertEquals(typeof pic.assets.hd, 'string');
  assertEquals(typeof pic.assets.sd, 'string');
  assertEquals(pic.license, 'CC-BY-SA-4.0');
  if (Math.abs(pic.lon - 2.350124972) > 1e-9) throw new Error('bad lon');
  if (Math.abs(pic.lat - 48.854973972) > 1e-9) throw new Error('bad lat');
});

Deno.test('normalizeItem: field_of_view 360 means equirectangular', () => {
  const item = structuredClone(fixture);
  item.properties['pers:interior_orientation'].field_of_view = 360;
  assertEquals(normalizeItem(item).type, 'equirectangular');
});

Deno.test('normalizeItem: reads pers:roll / pers:pitch camera tilt (#47)', () => {
  const item = structuredClone(fixture);
  item.properties['pers:roll'] = 6.6;
  item.properties['pers:pitch'] = 0.6;
  const pic = normalizeItem(item);
  assertEquals(pic.roll, 6.6);
  assertEquals(pic.pitch, 0.6);
});

Deno.test('normalizeItem: roll/pitch default to 0 when absent', () => {
  const pic = normalizeItem(fixture);
  assertEquals(pic.roll, 0);
  assertEquals(pic.pitch, 0);
});

Deno.test('normalizeItem: GPano equirectangular projection tag means equirectangular', () => {
  const item = structuredClone(fixture);
  delete item.properties['pers:interior_orientation'].field_of_view;
  item.properties.exif = { 'Xmp.GPano.ProjectionType': 'equirectangular' };
  assertEquals(normalizeItem(item).type, 'equirectangular');
});

Deno.test('normalizeItem: pano flag means equirectangular', () => {
  const item = structuredClone(fixture);
  delete item.properties['pers:interior_orientation'].field_of_view;
  item.properties.pano = true;
  assertEquals(normalizeItem(item).type, 'equirectangular');
});

// #40 regression: a 2:1 sensor ratio must NOT by itself make a photosphere —
// flat wide-camera frames (3168×1584) are also 2:1 and were wrongly stretched
// across the whole sphere. Without 360° metadata the picture is flat.
Deno.test('normalizeItem: 2:1 sensor ratio alone is NOT equirectangular (#40)', () => {
  const item = structuredClone(fixture);
  delete item.properties['pers:interior_orientation'].field_of_view;
  delete item.properties.pano;
  delete item.properties.exif;
  item.properties['pers:interior_orientation'].sensor_array_dimensions = [3168, 1584];
  assertEquals(normalizeItem(item).type, 'flat');
});

// A partial-FOV equirectangular derivative (e.g. 180°) is not a full sphere.
Deno.test('normalizeItem: sub-360 field of view is flat, not a full sphere (#40)', () => {
  const item = structuredClone(fixture);
  item.properties['pers:interior_orientation'].field_of_view = 180;
  assertEquals(normalizeItem(item).type, 'flat');
});

Deno.test('idFromHref extracts item ids', () => {
  assertEquals(idFromHref('https://x/api/collections/abc/items/41340'), '41340');
  assertEquals(
    idFromHref('https://x/api/collections/abc/items/5914cdbb-36a9-4e91-8527-fbebcf96d8d4'),
    '5914cdbb-36a9-4e91-8527-fbebcf96d8d4'
  );
  assertEquals(idFromHref(undefined), null);
});
