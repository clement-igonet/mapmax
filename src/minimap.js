// Street-view minimap (#7): a small inset showing nearby Panoramax coverage as
// dots around the current position, with a wedge for the current look heading.
// Schematic (no extra WebGL context / tile requests) so it stays cheap while
// the tile budget (#11) keeps the main map's tiles suspended.
import { projectToMinimap } from './geo.js';
import { searchNearby } from './panoramax.js';
import { onPictureChanged, isStreetMode, _photosphere } from './streetview.js';

const SIZE = 132;
const METERS_PER_PX = 0.6; // ~40 m across the minimap

export function setupMinimap(map) {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let state = null; // { center, points }
  let raf = 0;

  onPictureChanged((pic) => {
    if (!pic) {
      state = null;
      cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, SIZE, SIZE);
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    state = { center: [pic.lon, pic.lat], points: [] };
    draw();
    searchNearby(pic.lon, pic.lat, 40, 60)
      .then((cands) => {
        if (state) state.points = cands.map((c) => [c.lon, c.lat]);
      })
      .catch(() => {});
    if (!raf) loop();
  });

  function loop() {
    draw();
    raf = isStreetMode() ? requestAnimationFrame(loop) : 0;
  }

  function draw() {
    if (!state) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(20,20,24,0.85)';
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.fill();

    // nearby pictures
    ctx.fillStyle = '#2962ff';
    for (const p of state.points) {
      const { x, y } = projectToMinimap(state.center, p, METERS_PER_PX, SIZE);
      if (x < 0 || x > SIZE || y < 0 || y > SIZE) continue;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // look-direction wedge
    const ps = _photosphere();
    const yaw = ps ? (ps.yaw * Math.PI) / 180 : 0;
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(yaw);
    ctx.fillStyle = 'rgba(255,111,0,0.7)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8, -24);
    ctx.lineTo(8, -24);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // current position
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff6f00';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
