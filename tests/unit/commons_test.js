// Unit tests for the Wikimedia Commons adapter (#112 phase 3) — pure parts:
// page normalization, search-query building, HTML stripping, contract.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { commonsSource, normalizePage, searchParams, stripHtml } from '../../src/commons.js';
import { _resetSources, isEditable, registerSource, sourceOf } from '../../src/sources.js';

// Shape observed live (generator=search + coordinates|imageinfo, 2026-08-15).
const page = {
  pageid: 191480303,
  title: 'File:Mapillary (135639369066635).jpg',
  coordinates: [{ lat: 48.8538009, lon: 2.3482781, primary: true }],
  imageinfo: [{
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/example.jpg',
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/example.jpg/2048px-example.jpg',
    width: 5760,
    height: 2880,
    timestamp: '2024-05-12T10:00:00Z',
    extmetadata: {
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      Artist: { value: 'Stefdegreef <span class="mw-valign">via Mapillary</span>' },
      Categories: { value: 'Photos from Mapillary|360° panoramas|Paris' },
      DateTimeOriginal: { value: '2023-07-01 12:34:56' },
    },
  }],
};

Deno.test('normalizePage: Commons file → normalized 360° picture, per-file license', () => {
  const pic = normalizePage(page);
  assertEquals(pic.id, '191480303');
  assertEquals(pic.source, 'commons');
  assertEquals(pic.type, 'equirectangular'); // category-driven, never ratio (#40)
  assertEquals([pic.lon, pic.lat], [2.3482781, 48.8538009]);
  assertEquals(pic.heading, 0); // no heading on Commons — 🔧 Adjust is the fix
  assert(!pic.hasCompass);
  assertEquals(pic.license, 'CC BY-SA 4.0'); // per file, from extmetadata
  assertEquals(pic.producer, 'Stefdegreef via Mapillary'); // HTML stripped
  assert(pic.assets.hd.startsWith('https://upload.wikimedia.org/'));
  assert(pic.assets.sd.includes('2048px'));
  assertEquals(pic.datetime, '2023-07-01 12:34:56');
  assertEquals(pic.sequenceId, null);
  assertEquals(pic.tiles, null);
});

Deno.test('normalizePage: a page outside the 360° category is flat, not stretched (#40)', () => {
  const flat = normalizePage({
    ...page,
    imageinfo: [{ ...page.imageinfo[0], extmetadata: { ...page.imageinfo[0].extmetadata, Categories: { value: 'Paris|Bridges' } } }],
  });
  assertEquals(flat.type, 'flat');
  assertEquals(flat.hfov, 70);
  // Missing category metadata (bare-id fetch): trust our own search funnel.
  const bare = normalizePage({ pageid: 7, coordinates: [{ lat: 1, lon: 2 }], imageinfo: [{ url: 'https://u/x.jpg' }] });
  assertEquals(bare.type, 'equirectangular');
});

Deno.test('searchParams: category + nearcoord filters, bounded limits', () => {
  const p = searchParams(2.35, 48.853, 500, 50);
  assert(p.gsrsearch.includes('incategory:"360° panoramas"'));
  assert(p.gsrsearch.includes('nearcoord:500m,48.853,2.35'));
  assertEquals(p.gsrnamespace, '6');
  assertEquals(p.origin, '*'); // anonymous CORS
  assertEquals(searchParams(0, 0, 3, 999).gsrsearch.includes('nearcoord:10m'), true); // radius floor
  assertEquals(searchParams(0, 0, 3, 999).gsrlimit, '100'); // limit cap
  assertEquals(searchParams(0, 0, 50, 50, { coordsOnly: true }).prop, 'coordinates');
});

Deno.test('stripHtml: artist markup reduced to text', () => {
  assertEquals(stripHtml('A <a href="x">B</a> <span>C</span>'), 'A B C');
  assertEquals(stripHtml(undefined), undefined);
});

Deno.test('commonsSource: registry contract; editable (local Adjust fixes headings)', () => {
  _resetSources();
  registerSource(commonsSource); // throws if the contract is not met
  assertEquals(commonsSource.capabilities, { editable: true, hdTiles: false, sequences: false });
  assertEquals(commonsSource.dotColors, { equirectangular: '#8e24aa' }); // no flat swatch
  const pic = normalizePage(page);
  assertEquals(sourceOf(pic).id, 'commons');
  assert(isEditable(pic)); // heading is usually missing — Adjust must arm
  _resetSources();
});
