// Solar position (NOAA approximation) — pure, no browser APIs, unit-tested.
//
// Used as an absolute compass (#66): the sun's azimuth at capture time is
// computable from the picture's datetime + GPS alone, so spotting the sun in the
// panorama reveals the image's true orientation independently of any
// (unreliable) heading metadata.

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Sun azimuth (deg from north, clockwise) and elevation (deg above horizon)
// at ISO datetime `iso` seen from lon/lat. Accuracy ~0.2° — plenty for a
// 180°-flip decision.
export function solarPosition(iso, lon, lat) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new Error(`bad datetime: ${iso}`);
  const startOfYear = Date.UTC(t.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((t.getTime() - startOfYear) / 86400000) + 1;
  const hours = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours / 24 - 0.5));
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqtime + 4 * lon; // minutes (UTC reference)
  const trueSolarTime = hours * 60 + timeOffset;
  const ha = rad(trueSolarTime / 4 - 180);
  const latR = rad(lat);

  const cosZen = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const azimuth = (deg(Math.atan2(
    -Math.sin(ha) * Math.cos(decl),
    Math.sin(decl) * Math.cos(latR) - Math.cos(decl) * Math.sin(latR) * Math.cos(ha)
  )) + 360) % 360;

  return { azimuth, elevation: 90 - deg(zen) };
}
