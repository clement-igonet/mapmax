// Unit tests for level-aware nav (#124): altitude parsing and level grouping.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { groupByLevel, parseAltitude, LEVEL_SPLIT_M } from '../../src/levels.js';

Deno.test('parseAltitude: exif rationals, plain values, below-sea ref', () => {
  assertEquals(parseAltitude('196077/1000'), 196.077); // the Toulouse bridge deck
  assertEquals(parseAltitude('188.2'), 188.2);
  assertEquals(parseAltitude(82.379), 82.379);
  assertEquals(parseAltitude('4/1', '1'), -4); // GPSAltitudeRef 1 = below sea level
  assertEquals(parseAltitude('garbage'), undefined);
  assertEquals(parseAltitude(undefined), undefined);
});

Deno.test('groupByLevel: bridge deck vs quay — grouped, not merged (#124)', () => {
  const eye = { id: 'me', source: 'panoramax', alt: 196 };
  const deck = [{ id: 'd1', source: 'panoramax', alt: 195.5 }, { id: 'd2', source: 'panoramax', alt: 196.8 }];
  const quay = [{ id: 'q1', source: 'panoramax', alt: 188 }, { id: 'q2', source: 'panoramax', alt: 187.2 }];
  const g = groupByLevel(eye, [...deck, ...quay]);
  assertEquals(g.same.map((c) => c.id), ['d1', 'd2']);
  assertEquals(g.levels.length, 1);
  assert(g.levels[0].dAlt < -LEVEL_SPLIT_M, 'quay level must read as below the deck');
  assertEquals(g.levels[0].items.map((c) => c.id), ['q2', 'q1']);
});

Deno.test('groupByLevel: fails OPEN — missing alt or other source stays on the eye level', () => {
  const eye = { id: 'me', source: 'panoramax', alt: 196 };
  const g = groupByLevel(eye, [
    { id: 'noalt', source: 'panoramax' }, // no altitude
    { id: 'mly', source: 'mapillary', alt: 82 }, // other source: reference not comparable
    { id: 'below', source: 'panoramax', alt: 188 },
  ]);
  assertEquals(g.same.map((c) => c.id), ['noalt', 'mly']);
  assertEquals(g.levels[0].items.map((c) => c.id), ['below']);
  // Eye without altitude: everything is one level (today's behavior).
  const g2 = groupByLevel({ id: 'me', source: 'panoramax' }, [{ id: 'x', source: 'panoramax', alt: 50 }]);
  assertEquals(g2.same.length, 1);
  assertEquals(g2.levels, []);
});

Deno.test('groupByLevel: distinct far levels split on gaps', () => {
  const eye = { id: 'me', source: 'panoramax', alt: 100 };
  const g = groupByLevel(eye, [
    { id: 'p1', source: 'panoramax', alt: 108 },
    { id: 'p2', source: 'panoramax', alt: 109 },
    { id: 'p3', source: 'panoramax', alt: 130 }, // its own level, far above
    { id: 'm1', source: 'panoramax', alt: 92 },
  ]);
  assertEquals(g.levels.length, 3);
  const deltas = g.levels.map((l) => Math.round(l.dAlt));
  assertEquals(deltas, [-8, 9, 30]); // sorted ascending by construction
});
