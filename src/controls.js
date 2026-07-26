// Google-Street-View-style controls layered on the photosphere plugin (#7):
// keyboard look + advance, wheel/keys FOV zoom, double-click-to-go. Touch drag
// and pinch live in the plugin itself.
import { advance } from './navigation.js';
import { isStreetMode, _photosphere } from './streetview.js';

const LOOK_STEP = 6; // degrees per key press
const FOV_STEP = 4;

export function setupControls(map) {
  window.addEventListener('keydown', (e) => {
    if (!isStreetMode()) return;
    const ps = _photosphere();
    if (!ps || ps.mode !== 'inside') return;
    switch (e.key) {
      case 'ArrowLeft': ps.look(-LOOK_STEP, 0); e.preventDefault(); break;
      case 'ArrowRight': ps.look(LOOK_STEP, 0); e.preventDefault(); break;
      case 'ArrowUp':
        if (e.shiftKey) advance(map, ps.yaw).catch(logNav);
        else ps.look(0, LOOK_STEP);
        e.preventDefault();
        break;
      case 'ArrowDown':
        if (e.shiftKey) advance(map, (ps.yaw + 180) % 360).catch(logNav);
        else ps.look(0, -LOOK_STEP);
        e.preventDefault();
        break;
      case 'w': case 'W': advance(map, ps.yaw).catch(logNav); break;
      case 's': case 'S': advance(map, (ps.yaw + 180) % 360).catch(logNav); break;
      case '+': case '=': ps.zoomFov(-FOV_STEP); break;
      case '-': case '_': ps.zoomFov(FOV_STEP); break;
      default: break;
    }
  });

  // Wheel = FOV zoom while inside (plugin disables map scroll-zoom there).
  map.getCanvas().addEventListener('wheel', (e) => {
    if (!isStreetMode()) return;
    const ps = _photosphere();
    if (!ps || ps.mode !== 'inside') return;
    e.preventDefault();
    ps.zoomFov(e.deltaY > 0 ? FOV_STEP : -FOV_STEP);
  }, { passive: false });

  // NOTE: no global double-click-to-go — it teleported on any double-click and
  // made looking around feel like it moved you (#30). Navigation happens only
  // by clicking a ground arrow or a nearby POI dot (handlers in navigation.js).
}

const logNav = (err) => console.error('navigation', err);
