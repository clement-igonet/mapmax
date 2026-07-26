// Unit tests for control-parity helpers (#7).
import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { chooseByHeading } from '../../src/arrows.js';
import { projectToMinimap } from '../../src/geo.js';

Deno.test('chooseByHeading: picks the arrow best aligned with the look direction', () => {
  const arrows = [
    { targetId: 'ahead', bearing: 10 },
    { targetId: 'right', bearing: 95 },
    { targetId: 'back', bearing: 190 },
  ];
  assertEquals(chooseByHeading(arrows, 0)?.targetId, 'ahead');
  assertEquals(chooseByHeading(arrows, 90)?.targetId, 'right');
  assertEquals(chooseByHeading(arrows, 180)?.targetId, 'back');
});

Deno.test('chooseByHeading: wraps across north and rejects nothing-ahead', () => {
  const arrows = [{ targetId: 'n', bearing: 350 }];
  assertEquals(chooseByHeading(arrows, 5)?.targetId, 'n'); // 15° apart, within tolerance
  assertEquals(chooseByHeading(arrows, 180), null); // ~170° away → nothing ahead
  assertEquals(chooseByHeading([], 0), null);
});

Deno.test('projectToMinimap: center maps to the middle', () => {
  const p = projectToMinimap([2.35, 48.85], [2.35, 48.85], 0.6, 132);
  assertAlmostEquals(p.x, 66, 1e-9);
  assertAlmostEquals(p.y, 66, 1e-9);
});

Deno.test('projectToMinimap: north is up, east is right', () => {
  const size = 132;
  const north = projectToMinimap([2.35, 48.85], [2.35, 48.851], 0.6, size);
  const east = projectToMinimap([2.35, 48.85], [2.351, 48.85], 0.6, size);
  assert(north.y < size / 2, 'north should be above center');
  assert(east.x > size / 2, 'east should be right of center');
});
