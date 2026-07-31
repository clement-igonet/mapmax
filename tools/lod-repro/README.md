# LOD repro — tile organization depends on camera orientation

A self-contained reproduction for [maplibre/maplibre-gl-js#8057](https://github.com/maplibre/maplibre-gl-js/issues/8057)
— *"Tile organization should depend on camera position only, not on camera
orientation."*

[`index.html`](index.html) stands the camera at **one fixed position** a few
metres above ground (via the public `calculateCameraOptionsFromTo`, the same call
a street-view app makes) and only changes the **look direction** (bearing, and a
little pitch). The camera-position input never changes. It records every tile the
map **requests** (`transformRequest`), so the effect shows through public
behaviour alone — no internal covering-tiles API.

If tile organization were position-only, rotating in place after the first view
settles would request **zero** new tiles.

## Run

Open `index.html` in a browser (loads MapLibre **6.0.0** as an ES module from
jsDelivr, tiles from OpenStreetMap). Optional eye height: `index.html?eye=10`.
Results print to the page and to `window.__REPORT__`.

## Observed (MapLibre 6.0.0, Paris, eye 3 m)

```
step        map.center (drifts)        zoom   pitch  bearing   NEW tiles   new-tile zooms
warmup      2.348800,48.854472         17.57    84.0        0          27     10,11,12,13,15,16,17,18,19   ← baseline
yaw 45      2.349952,48.854158         17.57    84.0       45           5     8,12,15,16
yaw 90      2.350429,48.853400         17.57    84.0       90           6     11,13,14,17,18,19
yaw 135     2.349952,48.852642         17.57    84.0      135           6     15,17,19
yaw 180     2.348800,48.852328         17.57    84.0      180          10     11,13,15,16,18,19
yaw 225     2.347648,48.852642         17.57    84.0     -135           1     18
pitch↓15    2.348800,48.854441         17.57    75.0        0           9     13,17,19

tiles requested by ROTATION ALONE (after the initial view settled): 37
```

Two things to note:
- **`map.center` drifts** although the camera *eye* is fixed — `calculateCameraOptionsFromTo`
  places the camera at the eye but the derived center is the look target, which
  moves with orientation. #4779 scales each tile's desired zoom by camera-to-**center**
  distance, so a moving center re-LODs on look.
- The **new-tile zoom sets differ per look direction** (yaw 45 → `8,12,15,16`;
  yaw 90 → `11,13,14,17,18,19`). Same standpoint, different tile organization —
  so a shared URL renders differently depending on where the user looked.

## Headless

```sh
node -e '(async()=>{const{chromium}=require("playwright");const b=await chromium.launch();
const p=await b.newPage();await p.goto("file:///path/to/index.html");
await p.waitForFunction(()=>window.__DONE__);console.log(await p.evaluate(()=>window.__REPORT__));
await b.close()})()'
```
