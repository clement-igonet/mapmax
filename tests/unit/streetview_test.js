// Unit tests for the picture → photosphere-plugin target mapping (plugin adoption).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { formatPicInfo, isEquirectangular, originalImageUrl, picBadge, pictureToTarget } from '../../src/target.js';

const pic = {
  lon: 2.325,
  lat: 48.86,
  heading: 208,
  assets: { hd: 'hd.jpg', sd: 'sd.jpg', thumb: 't.jpg' },
};

Deno.test('pictureToTarget: default prefers SD for snappy stepping', () => {
  assertEquals(pictureToTarget(pic), {
    lngLat: [2.325, 48.86],
    imageUrl: 'sd.jpg',
    bearing: 208,
  });
});

Deno.test('pictureToTarget: preferHd uses the sharper image for entry', () => {
  assertEquals(pictureToTarget(pic, true).imageUrl, 'hd.jpg');
});

Deno.test('pictureToTarget: falls back through sd → thumb, heading defaults to 0', () => {
  assertEquals(pictureToTarget({ lon: 1, lat: 2, assets: { thumb: 't.jpg' } }), {
    lngLat: [1, 2],
    imageUrl: 't.jpg',
    bearing: 0,
  });
});

Deno.test('formatPicInfo: shows the full id, type and author (#34)', () => {
  const s = formatPicInfo({ id: '5914cdbb-36a9-4e91-8527-fbebcf96d8d4', type: 'equirectangular', producer: 'Britzz' });
  assert(s.includes('5914cdbb-36a9-4e91-8527-fbebcf96d8d4'), 'must contain the full id');
  assert(s.includes('equirectangular'));
  assert(s.includes('Britzz'));
});

Deno.test('formatPicInfo: empty for no picture; omits author when absent', () => {
  assertEquals(formatPicInfo(null), '');
  assertEquals(formatPicInfo({ id: 'x', type: 'flat' }), 'flat · id x');
});

Deno.test('picBadge / isEquirectangular: 360° vs flat (#40)', () => {
  assertEquals(picBadge({ type: 'equirectangular' }), '360°');
  assertEquals(picBadge({ type: 'flat' }), 'flat');
  assertEquals(isEquirectangular({ type: 'equirectangular' }), true);
  assertEquals(isEquirectangular({ type: 'flat' }), false);
  assertEquals(isEquirectangular(null), false);
});

Deno.test('originalImageUrl: prefers hd, falls back, empty when none (#40)', () => {
  assertEquals(originalImageUrl({ assets: { hd: 'h', sd: 's', thumb: 't' } }), 'h');
  assertEquals(originalImageUrl({ assets: { sd: 's' } }), 's');
  assertEquals(originalImageUrl({ assets: {} }), '');
  assertEquals(originalImageUrl(null), '');
});
