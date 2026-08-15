// Level-aware navigation (#124) — pure, unit-tested offline.
//
// On a bridge, the floor dots used to mix deck pictures with quay pictures
// 8 m below: every POI is projected onto ONE ground plane at the eye's level.
// Group candidates by altitude instead: only the eye's level keeps floor
// dots/arrows; other levels surface as ↑/↓ jump chips.
//
// Altitude caveats drive the rules here:
// - References differ BETWEEN sources (Panoramax exif GPSAltitude vs
//   Mapillary GPS altitude; geoid vs ellipsoid is ~45 m apart in France) —
//   only candidates sharing the EYE's source are comparable.
// - GPS altitude noise is metres — LEVEL_SPLIT_M must clear it while still
//   separating a deck from a quay (~8 m).
// - Anything non-comparable (missing alt, other source) FAILS OPEN to the
//   eye's level: worst case is today's behavior, never a hidden picture.

export const LEVEL_SPLIT_M = 4;

// "196077/1000" (exif rational) | "196.1" | 196.1 → metres, or undefined.
export function parseAltitude(v, ref) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(v.trim());
    if (m) n = parseFloat(m[1]) / (m[2] ? parseFloat(m[2]) : 1);
  }
  if (!Number.isFinite(n)) return undefined;
  return String(ref) === '1' ? -n : n; // GPSAltitudeRef 1 = below sea level
}

// Split `candidates` into the eye's level and other levels.
// Returns { same: [...candidates], levels: [{ dAlt, items }] } where dAlt is
// the group's mean altitude delta (m, + = above the eye) and items keep their
// per-candidate dAlt; groups are formed by gaps > `split` on sorted deltas.
export function groupByLevel(eye, candidates, split = LEVEL_SPLIT_M) {
  const comparable = (c) =>
    Number.isFinite(c?.alt) && Number.isFinite(eye?.alt) && c.source === eye.source;
  const same = [];
  const off = [];
  for (const c of candidates) {
    if (!comparable(c)) {
      same.push(c);
      continue;
    }
    const dAlt = c.alt - eye.alt;
    if (Math.abs(dAlt) <= split) same.push(c);
    else off.push({ ...c, dAlt });
  }
  off.sort((a, b) => a.dAlt - b.dAlt);
  const groups = [];
  for (const c of off) {
    const g = groups[groups.length - 1];
    if (g && c.dAlt - g.items[g.items.length - 1].dAlt <= split) g.items.push(c);
    else groups.push({ items: [c] });
  }
  return {
    same,
    levels: groups.map((g) => ({
      dAlt: g.items.reduce((s, c) => s + c.dAlt, 0) / g.items.length,
      items: g.items,
    })),
  };
}
