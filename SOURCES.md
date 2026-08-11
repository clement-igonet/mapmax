# SOURCES — 360° panorama imagery MapMax can use

maplibre-gl-photosphere is deliberately source-agnostic: a viewer target is
just `{lngLat, imageUrl (equirectangular), bearing, panoPitch?, panoRoll?,
tiles?}`. Any source below can feed it through a small adapter (the
`normalizeItem()` pattern of maplibre-gl-panoramax: source API → target).
What MapMax needs on top of a picture: position + heading metadata, sequence
links for walking, clear licensing for display with attribution, and CORS.

## Overview

| Source | 360° content | API / access | License | Sequences | Integration |
|---|---|---|---|---|---|
| **Panoramax** (current) | native, tiled HD | STAC, open, no key | free licenses (CC-BY-SA 4.0 & co.) | yes | ✅ done (maplibre-gl-panoramax) |
| **Mapillary** | large volume (`is_pano`) | Graph API, free token | CC-BY-SA 4.0 | yes | best next candidate |
| **KartaView** | some (mostly flat dashcam) | open API | CC-BY-SA 4.0 | yes | low effort, low 360 yield |
| **Wikimedia Commons** | curated landmarks (`Pano360`) | MediaWiki API, no key | per-file (CC0/CC-BY/CC-BY-SA) | no | niche, high quality |
| **Flickr (CC equirects)** | sparse | API key | per-photo CC filters | no | long tail |
| **Self-hosted GeoVisio** | whatever you capture | same as Panoramax | your choice | yes | ✅ free (apiBase override) |
| **Plain files + index** | drone/GoPro captures | none (static JSON) | your choice | manual | trivial |
| Google Street View / Bing Streetside | huge | proprietary | ToS forbid this use | — | ❌ excluded |

## Panoramax — the backbone (integrated)

Federated open street-level imagery (OSM-FR, IGN, self-hosted instances) via
the meta-catalog `api.panoramax.xyz`. Native 360 metadata, sequences,
prev/next links, tiled HD derivates (progressive refinement), **and the only
source we can write corrections back to** (pose/position PATCH). Everything
in [maplibre-gl-panoramax](https://github.com/clement-igonet/maplibre-gl-panoramax).

## Mapillary — the volume play

- **API**: `https://graph.mapillary.com/images?access_token=…&bbox=…&fields=id,computed_geometry,compass_angle,is_pano,thumb_2048_url,thumb_original_url,sequence` —
  free client token, generous quotas. Coverage vector tiles exist for the map
  layer (like our Panoramax dots).
- **360**: `is_pano=true` images are equirectangular; `thumb_original_url`
  serves the full pano (time-limited CDN URLs — fetch lazily, don't persist).
- **Adapter**: `computed_geometry` → lngLat, `compass_angle` → bearing,
  sequence traversal via the `sequence` field. No tiled derivates → no HD
  refinement (single texture only).
- **License**: imagery CC-BY-SA 4.0, attribution "© Mapillary" required; API
  ToS apply (no bulk download/rehosting — we display straight from their CDN,
  same as we do for Panoramax).
- **Caveat**: token management (public token in a front-end-only app is
  acceptable per their client-token model), and read-only — corrections can't
  go anywhere.

## KartaView (ex-OpenStreetCam)

Open platform in the OSM ecosystem, `api.openstreetcam.org` / KartaView API.
Mostly flat dashcam sequences; 360 exists but is rare. Same adapter shape as
Mapillary (position, heading, sequence). Worth wiring only if a target area
happens to have coverage; flat frames would use MapMax's flat-picture path
(#40/#46), not the sphere.

## Wikimedia Commons — landmarks, museums, viewpoints

Files tagged `{{Pano360}}` / category *360° panoramas*, many geo-located.
Query: MediaWiki API `list=geosearch` (+ `prop=imageinfo&iiprop=url|extmetadata`
for URL + per-file license). No sequences, no heading in most files (assume
north or read EXIF GPano when present — our `readPoseFromExif` already does).
Great for point-of-interest spheres (inside a cathedral, a summit view) that
street coverage never captures. License must be displayed **per file**.

## Flickr — the long tail

API with license filters (CC only) + `equirectangular` tags/machine-tags,
geolocated. Sparse and uneven, needs an API key; same POI-style usage as
Commons. Lowest priority.

## Self-hosted GeoVisio / plain files — the white-label play

Two zero-friction options for collectivités and private deployments:

1. **A GeoVisio instance** (the software behind Panoramax): full feature
   parity with the backbone — sequences, HD tiles, PATCH write-back —
   selected with a single `apiBase` override in maplibre-gl-panoramax. A
   commune's own imagery, their server, their license.
2. **A static JSON index + equirect JPEGs** (e.g. GoPro Max / drone output on
   any web server): the plugin needs nothing more than
   `[{lngLat, imageUrl, bearing}]`. No API at all — fits MapMax's
   front-end-only rule (R3) perfectly.

## Explicitly excluded

Google Street View and Bing Streetside: their terms prohibit extraction and
display outside their own viewers. Not an option, whatever the coverage.

## Suggested order

1. **Mapillary adapter** — biggest coverage gain for one adapter; read-only.
2. **Wikimedia Commons POI spheres** — high-quality indoor/viewpoint content
   that differentiates MapMax from pure street coverage.
3. **Self-hosted GeoVisio recipe** — a documented white-label setup
   (BUSINESS.md: this is the commercial offer, not just a source).
4. KartaView / Flickr — opportunistic, behind the same adapter interface.
