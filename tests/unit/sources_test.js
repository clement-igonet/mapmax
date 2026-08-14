// Unit tests for the source-adapter registry (#112 phase 1): registration
// contract, id→adapter routing, cross-source aggregation, capability gating.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  _resetSources,
  allSources,
  decodePicRef,
  dotColor,
  defaultSource,
  encodePicRef,
  fetchTilesConfig,
  getPicture,
  getSequence,
  getSourceById,
  hexToRgb01,
  isEditable,
  registerSource,
  searchNearby,
  setSourceVisible,
  sourceOf,
} from '../../src/sources.js';
import { normalizeItem, panoramaxSource } from '../../src/panoramax.js';

const fixture = JSON.parse(
  await Deno.readTextFile(new URL('../fixtures/stac-item.json', import.meta.url))
);

// A minimal well-formed fake adapter.
const fake = (id, extra = {}) => ({
  id,
  name: id,
  capabilities: {},
  addCoverage() {},
  onPictureClick() {},
  getPicture: (picId) => Promise.resolve({ id: picId, source: id }),
  searchNearby: () => Promise.resolve([{ id: `${id}-1`, source: id }]),
  ...extra,
});

Deno.test('registerSource: enforces the adapter contract', () => {
  _resetSources();
  assertThrows(() => registerSource({}), Error, 'adapter.id');
  assertThrows(() => registerSource({ id: 'x' }), Error, 'getPicture');
  const ok = registerSource(fake('ok'));
  assertEquals(getSourceById('ok'), ok);
  assertEquals(allSources().length, 1);
});

Deno.test('defaultSource: first registered answers bare ids', async () => {
  _resetSources();
  registerSource(fake('first'));
  registerSource(fake('second'));
  assertEquals(defaultSource().id, 'first');
  assertEquals((await getPicture('p1')).source, 'first');
  assertEquals((await getPicture('p1', 'second')).source, 'second');
  assertThrows(() => getPicture('p1', 'nope'), Error, "no source 'nope'");
});

Deno.test('sourceOf: routes by pic.source, falls back to default for legacy pics', () => {
  _resetSources();
  registerSource(fake('main'));
  registerSource(fake('other'));
  assertEquals(sourceOf({ source: 'other' }).id, 'other');
  assertEquals(sourceOf({ id: 'pre-#112, no source field' }).id, 'main');
  assertEquals(sourceOf(null).id, 'main');
});

Deno.test('searchNearby: aggregates every source; one failure hides nothing', async () => {
  _resetSources();
  registerSource(fake('a'));
  registerSource(fake('down', { searchNearby: () => Promise.reject(new Error('api 500')) }));
  registerSource(fake('b'));
  const found = await searchNearby(2.35, 48.85, 30, 50);
  assertEquals(found.map((p) => p.source).sort(), ['a', 'b']);
});

Deno.test('capability gating: no sequences → empty walk; no hdTiles → null', async () => {
  _resetSources();
  registerSource(fake('plain')); // capabilities: {}
  assertEquals(await getSequence({ source: 'plain', sequenceId: 's1' }, 10), []);
  assertEquals(await fetchTilesConfig({ source: 'plain', id: 'p1' }), null);

  _resetSources();
  registerSource(
    fake('rich', {
      capabilities: { sequences: true, hdTiles: true },
      getSequence: (seqId, limit) => Promise.resolve([{ id: `${seqId}-${limit}` }]),
      fetchTilesConfig: () => Promise.resolve({ cols: 8, rows: 4 }),
    })
  );
  assertEquals((await getSequence({ source: 'rich', sequenceId: 's1' }, 10))[0].id, 's1-10');
  assertEquals((await fetchTilesConfig({ source: 'rich', id: 'p1' })).cols, 8);
});

Deno.test('isEditable: only when the owning adapter opts in (#112 read-only gate)', () => {
  _resetSources();
  registerSource(fake('ro'));
  registerSource(fake('rw', { capabilities: { editable: true } }));
  assert(!isEditable({ source: 'ro' }));
  assert(isEditable({ source: 'rw' }));
  // Unknown source falls back to the default ('ro' here) — stays read-only.
  assert(!isEditable({ source: 'ghost' }));
  _resetSources();
  assert(!isEditable({ source: 'anything' })); // empty registry: never editable
});

Deno.test('setSourceVisible: toggles only the declared layers that exist', () => {
  _resetSources();
  registerSource(fake('cov', { layers: ['cov-lines', 'cov-dots', 'cov-ghost'] }));
  registerSource(fake('bare')); // no layers declared — a no-op
  const calls = [];
  const map = {
    getLayer: (id) => id !== 'cov-ghost',
    setLayoutProperty: (id, prop, v) => calls.push([id, prop, v]),
  };
  setSourceVisible(map, 'cov', false);
  assertEquals(calls, [['cov-lines', 'visibility', 'none'], ['cov-dots', 'visibility', 'none']]);
  calls.length = 0;
  setSourceVisible(map, 'cov', true);
  assertEquals(calls, [['cov-lines', 'visibility', 'visible'], ['cov-dots', 'visibility', 'visible']]);
  setSourceVisible(map, 'bare', false);
  setSourceVisible(map, 'unknown', false);
  assertEquals(calls.length, 2); // nothing further
  _resetSources();
});

Deno.test('dotColor: the map palette follows pictures into the sphere (#112)', () => {
  _resetSources();
  registerSource(fake('painted', { dotColors: { equirectangular: '#00838f', flat: '#05cb63' } }));
  registerSource(fake('plain'));
  const rgb = dotColor({ source: 'painted', type: 'equirectangular' });
  assert(Math.abs(rgb[0] - 0) < 1e-9 && Math.abs(rgb[1] - 0x83 / 255) < 1e-9 && Math.abs(rgb[2] - 0x8f / 255) < 1e-9);
  assertEquals(dotColor({ source: 'painted', type: 'flat' }), hexToRgb01('#05cb63'));
  assertEquals(dotColor({ source: 'plain', type: 'equirectangular' }), [0.16, 0.4, 1.0]); // viewer default
  assertEquals(hexToRgb01('nope'), null);
  assertEquals(hexToRgb01('#ffffff'), [1, 1, 1]);
  _resetSources();
});

Deno.test('pic refs: non-default sources round-trip through the deep link (#112)', () => {
  _resetSources();
  registerSource(fake('panoramax'));
  registerSource(fake('mapillary'));
  // Default source: bare id — every pre-#112 ?pic= link keeps working.
  const uuid = '5914cdbb-36a9-4e91-8527-fbebcf96d8d4';
  assertEquals(encodePicRef({ id: uuid, source: 'panoramax' }), uuid);
  assertEquals(decodePicRef(uuid), { id: uuid, sourceId: undefined });
  // Non-default source: prefixed, and decoded back to the owning adapter.
  const enc = encodePicRef({ id: '854092095581010', source: 'mapillary' });
  assertEquals(enc, 'mapillary:854092095581010');
  assertEquals(decodePicRef(enc), { id: '854092095581010', sourceId: 'mapillary' });
  // A prefix that is not a registered source stays part of the id.
  assertEquals(decodePicRef('ghost:123'), { id: 'ghost:123', sourceId: undefined });
  _resetSources();
});

Deno.test('panoramaxSource: satisfies the contract; pictures carry source', () => {
  _resetSources();
  registerSource(panoramaxSource); // throws if the contract is not met
  assertEquals(panoramaxSource.capabilities, { editable: true, hdTiles: true, sequences: true });
  const pic = normalizeItem(fixture);
  assertEquals(pic.source, 'panoramax');
  assertEquals(sourceOf(pic).id, 'panoramax');
  assert(isEditable(pic));
  _resetSources();
});
