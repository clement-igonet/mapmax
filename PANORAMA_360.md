# PANORAMA_360 — how MapMax finds, places and orients a photosphere

How a Panoramax picture becomes a walkable 360° photosphere in MapMax, where every
number comes from (camera headers → Panoramax processing → STAC API → MapMax), and
the concrete glitches that appear when we overlay it on OSM/vector data.

All example values below are **real**, pulled from `api.panoramax.xyz` on
2026-07-29. Reproduce any of them with the deep-link URLs (the `?pic=…&pv=yaw_pitch`
scheme, #54).

---

## 1. The pipeline

```
360° camera (GoPro Max, Insta360, …)         → equirectangular JPEG + EXIF/XMP headers
   │  captures GPS, time, stitches to 2:1 pano
   ▼
Panoramax instance (GeoVisio)                → re-derives heading/roll/pitch, blurs faces/plates,
   │  ingest + processing                       assigns a sequence, publishes a STAC Item
   ▼
STAC API  /api/search?ids=<id>               → GeoJSON Feature: geometry + properties + assets
   │
   ▼
MapMax  src/panoramax.js normalizeItem()     → {lon,lat,heading,type,assets,sequence,…}
   │
   ▼
Photosphere plugin + MapLibre                → textured sphere at eye height, blended with OSM vector
```

Fetch the raw item yourself:
`https://api.panoramax.xyz/api/search?ids=65ab0c8d-6c9b-4f35-b8fb-a156f4302379`

---

## 2. Identifying a POI as a 360° photosphere

A Panoramax picture is a **full sphere** only if it is equirectangular and covers
360°×180°. The signals, in order of trust:

| Signal | Where | Example (65ab0c8d) |
|---|---|---|
| `Xmp.GPano.ProjectionType = equirectangular` | picture XMP header → API `properties.exif` | `equirectangular` |
| `Xmp.GPano.UsePanoramaViewer = True` | XMP | `True` |
| `pers:interior_orientation.field_of_view = 360` | Panoramax-computed | `360` |
| `Xmp.GPano.FullPanoWidthPixels == CroppedAreaImageWidthPixels`, `CroppedAreaLeftPixels = 0` | XMP (full, uncropped 360) | `5760 == 5760`, `0` |
| 2:1 sensor ratio `sensor_array_dimensions` | Panoramax | `[5760, 2880]` = 2.0 |

**MapMax rule** (`normalizeItem`, #40): equirectangular **iff** `GPano.ProjectionType === 'equirectangular'` **or** `field_of_view ≥ 355` **or** the STAC `pano` flag is true. The **2:1 ratio alone is deliberately rejected** — a flat wide-camera frame (e.g. 3168×1584) is also exactly 2:1, so trusting the ratio produced false spheres. Everything else is a `flat` picture (shown as a popup, not wrapped onto the sphere).

---

## 3. Locating it (position + elevation)

### Horizontal position
- **Source:** camera GPS → `Exif.GPSInfo.GPSLatitude/GPSLongitude` (deg/min/sec fractions, e.g. `48/1 50/1 13917/392` = 48° 50′ 35.5″ N).
- **API:** `geometry.coordinates = [lon, lat]` (already decoded). Example: `[2.320250, 48.843195]`.
- **Accuracy:** `properties.quality:horizontal_accuracy` — **`4.0 m`** here (typical). This is the single biggest source of blend error (see §6).
- **MapMax:** anchors the sphere and the MapLibre eye at this lon/lat.

### Elevation
- **Source:** `Exif.GPSInfo.GPSAltitude` (e.g. `105297/1000` = **105.3 m**, `GPSAltitudeRef = 0` → above sea level). GPS altitude is far less accurate than horizontal (often ±10–30 m, and sometimes ellipsoidal vs geoid).
- **Across pics:** 105.3 m, 86.2 m, 84.9 m, 47.2 m — all in central Paris (true ground ≈ 30–40 m MSL), so the numbers are noisy/inconsistent.
- **MapMax:** **does NOT use GPSAltitude.** It sits the eye at a fixed `eyeHeight = 1.6 m` above the MapLibre ground plane. → elevation glitch (§6).

---

## 4. Orienting it (heading, roll, pitch)

This is where header data is least trustworthy and Panoramax's re-computation matters.

| Quantity | Camera header (GoPro Max) | Panoramax-computed (API) | MapMax uses |
|---|---|---|---|
| **Heading** (azimuth of image centre) | `Xmp.GPano.PoseHeadingDegrees = 0.0` ← **placeholder!** | `view:azimuth = 87` (from GPS track / `GPSImgDirection`) | ✅ `view:azimuth` (#52) |
| **Roll** (horizon tilt) | `Xmp.GPano.PoseRollDegrees = 0.0` ← placeholder | `pers:roll = 6.6` | ❌ **not applied** |
| **Pitch** (nose up/down) | `Xmp.GPano.PosePitchDegrees = 0.0` ← placeholder | `pers:pitch = 0.6` | ❌ not applied |
| Viewer defaults | `Xmp.GPano.InitialView*Degrees = 0.0` | — | ignored |

**Key lesson:** on this GoPro Max the entire `GPano.Pose*` block is a `0.0` placeholder. The *real* orientation lives in Panoramax's **`view:azimuth` / `pers:roll` / `pers:pitch`**, which it derives during ingest. A viewer that trusts `GPano.PoseHeadingDegrees` would point every GoPro Max pano at north.

**Texture ↔ world mapping (#52):** an equirectangular's centre column faces `view:azimuth`. MapMax rotates the sphere sampling by that heading so the photo lines up with the map (`u = 0.5 + (θ − panoYaw)/2π`, `panoYaw = view:azimuth`). It does **not** yet rotate by `pers:roll`/`pers:pitch` → §6.

---

## 5. The other half: OSM / vector data

The vector world MapMax blends onto the photo comes from **OpenMapTiles** vector tiles (OpenStreetMap data, via OpenFreeMap):
- **Roads, water, landuse, labels** — placed at absolute lon/lat.
- **3D buildings** — `building` source-layer, extruded by `render_height` / `render_min_height` (OSM `height` / `building:levels`), rendered as `fill-extrusion`.
- MapMax draws the photosphere in a full-screen WebGL layer and cross-fades it with these MapLibre layers (the Photo↔Vector slider, #6/#24). Nav arrows/dots for neighbour panos are drawn on the floor plane inside the same shader (#26/#39).

For the overlay to line up, **both** must agree on: position, eye height, heading, roll/pitch, and per-object distance. §6 is what happens when they don't.

---

## 6. Glitches revealed by the blend (with repro links)

> Open a link, drag the Photo↔Vector slider toward "Vector", and compare.

### G1 — Orientation: horizon ROLL not corrected  ⚠️ unhandled
`pers:roll = 6.6°` on `65ab0c8d`, but MapMax renders the sphere level. The photo
horizon is tilted ~6.6° against the (level) vector horizon and 3D-building tops.
- **Repro:** `…/?pic=65ab0c8d-6c9b-4f35-b8fb-a156f4302379&pv=87_0` — look at the far horizon; the photo skyline is slightly rotated vs the vector.
- **Fix path:** apply `pers:roll` (and `pers:pitch`) as a rotation of the view basis in the photosphere shader.

### G2 — Elevation gap  ⚠️ unhandled
MapMax puts the eye at a fixed **1.6 m over the MapLibre ground**, ignoring
`GPSAltitude` and the real camera height (a GoPro Max on a bike/car sits ~1.1–2.5 m; the altitudes above swing 47→105 m and are unreliable anyway). So the vector **ground plane and building bases sit at a different height** than the photo ground → buildings appear to float or sink, and the floor arrows can disagree with the photo curb.
- Most visible where the street slopes or the capture height ≠ 1.6 m.
- **Fix path:** offset eye height by camera-height metadata when present; long-term, use a terrain/DEM ground.

### G3 — Position jitter (±4 m)  ✔ partly mitigated
`quality:horizontal_accuracy = 4.0 m`. The vector world is rendered from the
*recorded* GPS point, up to 4 m from where the photo was actually shot.
- **Near objects** (parked cars, the building face 3 m away) shift noticeably; far objects barely move.
- **Neighbour arrows/dots** chase noisy neighbour GPS points → they drift off the path. Mitigated by snapping the forward/back arrows to `view:azimuth` (#55), but the dots still sit on raw positions.
- **Repro:** any tight street, e.g. `…/?pic=13d889da-c825-40a0-a4a7-da9d50606bc2` — near façade vs vector building edge.

### G4 — Parallax (fundamental)  ✖ not fixable without depth
The photo is mapped onto a **6 m sphere** (direction-only); vector geometry is at
its true 3D distance. Only the *directions* of far features can align — near
geometry can't, because a single radius can't equal every object's depth. Google
Street View solves this with a per-pixel depth mesh; Panoramax ships no depth.

### G5 — Coarse building geometry
Street-mode zoom (z18) is served from generalized **z14** OSM tiles, so building
footprints are blocky/merged and small ones are dropped. Even a perfectly-placed
near building won't trace the photo outline.

### G6 — Temporal drift
Photo `datetime = 2025-06-16`; OSM is edited continuously. New/removed buildings,
seasonal foliage, scaffolding and parked vehicles differ between the two layers.

### G7 — Placeholder metadata trap
`GPano.PoseHeadingDegrees/PoseRollDegrees/PosePitchDegrees = 0.0` on every GoPro Max
pano. Trusting them (instead of `view:azimuth` / `pers:roll` / `pers:pitch`) would
mis-orient every panorama. Always prefer the Panoramax `pers:*` / `view:*` fields.

---

## 7. Status summary

| Concern | Metadata field | MapMax status |
|---|---|---|
| Is it a sphere? | `GPano.ProjectionType`, `field_of_view` | ✅ handled (#40) |
| Position | `geometry.coordinates` | ✅ used |
| Heading | `view:azimuth` | ✅ used (#52) |
| Arrow direction | `view:azimuth` vs neighbour GPS | ✅ snapped (#55) |
| **Roll** | `pers:roll` | ❌ **not applied (G1)** |
| **Pitch** | `pers:pitch` | ❌ not applied (G1) |
| **Elevation / eye height** | `GPSAltitude`, camera height | ❌ **fixed 1.6 m (G2)** |
| Position accuracy | `quality:horizontal_accuracy` | ⚠️ inherent (G3) |
| Depth / parallax | — (none published) | ✖ fundamental (G4) |
| Building fidelity | OSM `render_height`, z14 tiles | ⚠️ coarse (G5) |

**Next candidate fixes, by impact:** G1 (apply `pers:roll`/`pers:pitch` — cheap, removes visible tilt) → G2 (eye-height/elevation) → G5 (finer building source).
