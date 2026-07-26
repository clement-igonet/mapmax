// Unit tests for the picture → photosphere-plugin target mapping (plugin adoption).
import { assertEquals } from 'jsr:@std/assert@1';
import { pictureToTarget } from '../../src/target.js';

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
