// MapMax vendoring SHIM, not the real maplibre-gl-panoramax edit.js.
// gesture.js (vendored verbatim) imports normalizeYaw from './edit.js'; the
// real module also carries the Panoramax PATCH builders — server write-back
// that read-oriented MapMax deliberately does not ship (#110). Only the one
// pure helper is provided, identical to the upstream definition.
export const normalizeYaw = (deg) => ((deg % 360) + 360) % 360;
