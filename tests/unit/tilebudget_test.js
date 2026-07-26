// Unit tests for the street-mode tile budget (#11).
import { assertEquals } from 'jsr:@std/assert@1';
import { tiledLayerIds } from '../../src/tilebudget.js';

const style = {
  sources: {
    openmaptiles: { type: 'vector' },
    ne2_shaded: { type: 'raster' },
    terrain: { type: 'raster-dem' },
    'mapmax-nav-arrows': { type: 'geojson' },
    panoramax: { type: 'vector' },
  },
  layers: [
    { id: 'background', type: 'background' }, // no source
    { id: 'hillshade', type: 'raster', source: 'ne2_shaded' },
    { id: 'roads', type: 'line', source: 'openmaptiles' },
    { id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles' },
    { id: 'panoramax-pictures', type: 'circle', source: 'panoramax' },
    { id: 'nav-arrows', type: 'symbol', source: 'mapmax-nav-arrows' }, // geojson: keep
    { id: 'photosphere', type: 'custom' }, // custom: keep
  ],
};

Deno.test('tiledLayerIds selects only tile-backed layers (vector/raster/raster-dem)', () => {
  assertEquals(tiledLayerIds(style).sort(), [
    'building-3d', 'hillshade', 'panoramax-pictures', 'roads',
  ]);
});

Deno.test('tiledLayerIds keeps geojson, custom and sourceless layers loading-free', () => {
  const ids = tiledLayerIds(style);
  for (const kept of ['background', 'nav-arrows', 'photosphere']) {
    assertEquals(ids.includes(kept), false, `${kept} must not be suspended`);
  }
});

Deno.test('tiledLayerIds tolerates a style with no sources/layers', () => {
  assertEquals(tiledLayerIds({}), []);
});

Deno.test('tiledLayerIds(keepSources) excludes kept sources — Panoramax stays suspended (#27)', () => {
  const ids = tiledLayerIds(style, ['panoramax']);
  assertEquals(ids.includes('panoramax-pictures'), false, 'panoramax layer must be excluded');
  // OSM/raster layers still selected (they may resume for blend mixing)
  assertEquals(ids.sort(), ['building-3d', 'hillshade', 'roads']);
});
