// Vendored from clement-igonet/maplibre-plugin-photosphere (npm
// maplibre-gl-photosphere), plus the street-view sequence additions
// (_loadTexture / enter(target) / goTo / onMove) described in the plugin's
// reference notes. Kept in-tree so the mapmax Pages site is self-contained
// (buildless ESM, maplibre-gl as a peer). See SPECIFICATIONS.md §2.1–2.5.
//
// The layer renders through MapLibre's CustomLayerInterface: a full-screen
// fragment shader ray-casts each pixel against a finite sphere centered on the
// anchor and samples the equirectangular texture. At the sphere center this is
// plain 360° sampling; during the enter transition the eye offset gives real
// approach parallax.
import { MercatorCoordinate } from 'maplibre-gl';

const VERTEX_SHADER_SOURCE = `
    attribute vec2 aPosition;
    varying vec2 vNdc;
    void main() {
        vNdc = aPosition;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

const MAX_ARROWS = 6;
const ARROW_GROUND_DIST = 5; // where a ground arrow sits, from the eye (m)
const FRAGMENT_SHADER_SOURCE = `
    precision highp float;
    varying vec2 vNdc;
    uniform float uYaw;
    uniform float uPitch;
    uniform float uFovY;
    uniform float uAspect;
    uniform float uAlpha;
    uniform vec3 uSphereCenterOffset;
    uniform float uSphereRadius;
    uniform sampler2D uPanorama;
    uniform float uEyeHeight;      // eye height above the ground (m)
    uniform int uArrowCount;
    uniform vec2 uArrows[${MAX_ARROWS}]; // ground positions (east, north) m from the eye

    // A filled arrowhead in the arrow's local frame (x = right, y = forward),
    // tapering from a base to a tip that points toward the target.
    float arrowMask(vec2 lp) {
        float base = -0.7, tip = 1.7, halfW = 1.15;
        if (lp.y < base || lp.y > tip) return 0.0;
        float f = (lp.y - base) / (tip - base);         // 0 at base .. 1 at tip
        float w = halfW * (1.0 - f);                     // taper to a point
        return abs(lp.x) < w ? 1.0 : 0.0;
    }

    void main() {
        float tanHalfFovY = tan(uFovY * 0.5);
        float tanHalfFovX = tanHalfFovY * uAspect;

        vec3 forward = vec3(cos(uPitch) * sin(uYaw), cos(uPitch) * cos(uYaw), sin(uPitch));
        vec3 worldUp = vec3(0.0, 0.0, 1.0);
        vec3 right = normalize(cross(forward, worldUp));
        vec3 up = cross(right, forward);

        vec3 viewDir = normalize(forward + right * (vNdc.x * tanHalfFovX) + up * (vNdc.y * tanHalfFovY));

        // Base colour: the panorama sphere.
        vec3 rgb = vec3(0.0);
        float a = 0.0;
        vec3 originToCenter = -uSphereCenterOffset;
        float b = dot(originToCenter, viewDir);
        float c = dot(originToCenter, originToCenter) - uSphereRadius * uSphereRadius;
        float discriminant = b * b - c;
        if (discriminant >= 0.0) {
            float sq = sqrt(discriminant);
            float tNear = -b - sq;
            float tFar = -b + sq;
            float t = tNear > 0.0 ? tNear : tFar;
            if (t >= 0.0) {
                vec3 normal = normalize(viewDir * t - uSphereCenterOffset);
                float theta = atan(normal.x, normal.y);
                float phi = asin(clamp(normal.z, -1.0, 1.0));
                vec4 color = texture2D(uPanorama, vec2(0.5 + theta / (2.0 * 3.14159265359), 0.5 - phi / 3.14159265359));
                rgb = color.rgb;
                a = color.a * uAlpha;
            }
        }

        // Ground navigation arrows, drawn on the floor plane at z = -uEyeHeight.
        // Rendered here (in the panorama layer) they cover the whole viewport and
        // are never clipped by MapLibre's map-plane near clip (mapmax #26).
        if (viewDir.z < -0.0001 && uArrowCount > 0) {
            float tg = -uEyeHeight / viewDir.z;
            vec2 g = viewDir.xy * tg;                    // ground point (east, north) m
            float mask = 0.0;
            for (int i = 0; i < ${MAX_ARROWS}; i++) {
                if (i >= uArrowCount) break;
                vec2 ap = uArrows[i];
                if (dot(ap, ap) < 1e-4) continue;
                vec2 fwd = normalize(ap);
                vec2 rgt = vec2(fwd.y, -fwd.x);
                vec2 d = g - ap;
                mask = max(mask, arrowMask(vec2(dot(d, rgt), dot(d, fwd))));
            }
            if (mask > 0.0) {
                rgb = mix(rgb, vec3(1.0), 0.85);         // white arrow over the photo
                a = max(a, 0.85);                        // always visible, any blend
            }
        }

        if (a <= 0.0) discard;
        gl_FragColor = vec4(rgb, a);
    }
`;

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

const DEFAULT_OPTIONS = {
    eyeHeight: 1.6,
    zoom: 18,
    radius: 6,
    durationMs: 1500,
    dragSensitivity: 0.15,
    minPitch: -85,
    maxPitch: 85,
    fov: 75
};

/**
 * An immersive 360° photosphere anchored at a geographic point, rendered
 * through MapLibre's CustomLayerInterface. Supports Street-View-style sequence
 * navigation via enter(target) / goTo(target).
 */
export class Photosphere {
    constructor(map, options) {
        if (!options || !options.lngLat || !options.imageUrl) {
            throw new Error('Photosphere requires lngLat and imageUrl options');
        }
        this._map = map;
        this._options = { ...DEFAULT_OPTIONS, ...options };
        this._mode = 'outside';
        this._yawDeg = 0;
        this._pitchDeg = 0;
        this._dragging = false;
        this._lookTargetDistanceMetres = 1;
        this._opacity = 0;
        this._blend = 1; // steady-state opacity while inside (1 = photo only)
        this._savedFov = null; // map's vertical FOV before entering
        this._navArrows = []; // [{ bearing (deg), id }] rendered on the floor
        this._sphereCenterOffset = [0, 0, 0];
        this._gl = null;
        this._layerCtx = null;

        this._layer = this._createLayer();
        // MapLibre 6's internal `map.style` is not a truthy public property, so
        // the old `map.style && map.loaded()` guard fell through to a 'load'
        // listener that never fires when the style is already loaded — leaving
        // the custom layer unadded (onAdd never runs, textures never load).
        // Use the public isStyleLoaded() and add immediately when ready.
        const addLayer = () => {
            if (!map.getLayer(this._layer.id)) map.addLayer(this._layer);
        };
        if (map.isStyleLoaded()) {
            addLayer();
        } else {
            map.once('load', addLayer);
            map.once('styledata', addLayer);
        }

        this._pinchDist = 0;
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);
        const container = map.getContainer();
        container.addEventListener('mousedown', this._onMouseDown);
        addEventListener('mousemove', this._onMouseMove);
        addEventListener('mouseup', this._onMouseUp);
        container.addEventListener('touchstart', this._onTouchStart, { passive: false });
        container.addEventListener('touchmove', this._onTouchMove, { passive: false });
        container.addEventListener('touchend', this._onTouchEnd);
    }

    get mode() {
        return this._mode;
    }

    get lngLat() {
        return this._options.lngLat;
    }

    // Steady-state photo opacity while inside — lets vector layers behind the
    // sphere show through for photo↔mixed↔vector blending (mapmax #6).
    blend(alpha) {
        this._blend = Math.max(0, Math.min(1, alpha));
        this._map.triggerRepaint();
    }

    get yaw() { return this._yawDeg; }
    get pitch() { return this._pitchDeg; }

    // Ground navigation arrows rendered inside the panorama layer (mapmax #26).
    // `list` = [{ bearing (deg toward the target), id }].
    setNavArrows(list) {
        this._navArrows = Array.isArray(list) ? list.slice(0, MAX_ARROWS) : [];
        this._map.triggerRepaint();
    }

    // The id of the arrow under screen pixel (px, py), or null. Ray-casts the
    // floor with the same view maths as the shader (works at any pitch).
    groundPick(px, py) {
        const canvas = this._map.getCanvas();
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const ndcX = (px / w) * 2 - 1;
        const ndcY = 1 - (py / h) * 2;
        const tanY = Math.tan((this._options.fov * Math.PI / 180) / 2);
        const tanX = tanY * (w / h);
        const yaw = this._yawDeg * Math.PI / 180;
        const pitch = this._pitchDeg * Math.PI / 180;
        const forward = [Math.cos(pitch) * Math.sin(yaw), Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)];
        const right = normalize3(cross3(forward, [0, 0, 1]));
        const up = cross3(right, forward);
        const vd = normalize3([
            forward[0] + right[0] * ndcX * tanX + up[0] * ndcY * tanY,
            forward[1] + right[1] * ndcX * tanX + up[1] * ndcY * tanY,
            forward[2] + right[2] * ndcX * tanX + up[2] * ndcY * tanY,
        ]);
        if (vd[2] >= -1e-4) return null; // not looking at the floor
        const t = -this._options.eyeHeight / vd[2];
        const g = [vd[0] * t, vd[1] * t];
        for (const a of this._navArrows) {
            const br = a.bearing * Math.PI / 180;
            const ap = [ARROW_GROUND_DIST * Math.sin(br), ARROW_GROUND_DIST * Math.cos(br)];
            const len = Math.hypot(ap[0], ap[1]) || 1;
            const fwd = [ap[0] / len, ap[1] / len];
            const rgt = [fwd[1], -fwd[0]];
            const d = [g[0] - ap[0], g[1] - ap[1]];
            const ly = d[0] * fwd[0] + d[1] * fwd[1];
            const lx = d[0] * rgt[0] + d[1] * rgt[1];
            const base = -0.7, tip = 1.7, halfW = 1.15;
            if (ly > base && ly < tip && Math.abs(lx) < halfW * (1 - (ly - base) / (tip - base))) {
                return a.id;
            }
        }
        return null;
    }

    // Look around by a delta (degrees) — drives keyboard / touch controls
    // outside the built-in mouse drag (mapmax #7).
    look(deltaYawDeg, deltaPitchDeg) {
        if (this._mode !== 'inside') return;
        const { minPitch, maxPitch } = this._options;
        this._yawDeg = (this._yawDeg + deltaYawDeg + 360) % 360;
        this._pitchDeg = Math.max(minPitch, Math.min(maxPitch, this._pitchDeg + deltaPitchDeg));
        this._updateCameraWhileInside();
        this._map.triggerRepaint();
    }

    // Field-of-view zoom (degrees), clamped — scroll wheel / pinch (mapmax #7).
    zoomFov(deltaDeg) {
        this._options.fov = Math.max(25, Math.min(100, this._options.fov + deltaDeg));
        this._applyMapFov();
        if (this._mode === 'inside') {
            this._recalibrateLookTargetDistance();
            this._updateCameraWhileInside();
        }
        this._map.triggerRepaint();
    }

    // Keep MapLibre's vertical FOV equal to the sphere shader's FOV so the photo
    // and the vector layers move at the same rate — no desync (mapmax #24).
    _applyMapFov() {
        const map = this._map;
        if (typeof map.setVerticalFieldOfView === 'function') {
            map.setVerticalFieldOfView(this._options.fov);
        } else if (map.transform) {
            map.transform.fov = this._options.fov;
        }
    }

    // Enter the photosphere. Optional target = {lngLat, imageUrl, bearing}
    // retargets to a specific panorama first (used for street-view sequences).
    enter(target) {
        if (this._mode !== 'outside') {
            return;
        }
        if (target) {
            if (target.lngLat) this._options.lngLat = target.lngLat;
            if (target.imageUrl) {
                this._options.imageUrl = target.imageUrl;
                this._loadTexture(target.imageUrl);
            }
        }
        this._mode = 'entering';
        for (const handler of this._interactionHandlers()) {
            handler.disable();
        }
        // Match the map's vertical FOV to the sphere's so photo and vector move
        // together (mapmax #24). Do it before recalibrating (which reads the fov).
        if (typeof this._map.getVerticalFieldOfView === 'function') {
            this._savedFov = this._map.getVerticalFieldOfView();
        }
        this._applyMapFov();
        // Start looking toward the picture's heading, if provided.
        this._yawDeg = target && typeof target.bearing === 'number' ? target.bearing : 0;
        this._pitchDeg = 0;
        this._recalibrateLookTargetDistance();
        const { lngLat, zoom, eyeHeight, onEnter } = this._options;
        this._animate({ center: lngLat, zoom, pitch: 90, bearing: this._yawDeg }, eyeHeight, 1, () => {
            this._mode = 'inside';
            this._updateCameraWhileInside();
            if (onEnter) onEnter();
        });
    }

    // Walk to an adjacent panorama while inside. Loads the next equirectangular
    // image, then swaps the anchor + eye to its location once decoded (no
    // flash), preserving the current look direction. Fires onMove.
    goTo(target) {
        if (this._mode !== 'inside' || !target || !target.imageUrl) {
            return;
        }
        this._loadTexture(target.imageUrl, (err) => {
            if (err) return;
            if (target.lngLat) this._options.lngLat = target.lngLat;
            this._options.imageUrl = target.imageUrl;
            this._sphereCenterOffset = [0, 0, 0];
            this._recalibrateLookTargetDistance();
            this._updateCameraWhileInside();
            this._map.triggerRepaint();
            if (this._options.onMove) this._options.onMove(target);
        });
    }

    exit() {
        if (this._mode !== 'inside') {
            return;
        }
        this._mode = 'exiting';
        const view = this._options.exitView || {
            center: this._options.lngLat, zoom: this._options.zoom - 1, pitch: 60, bearing: 0
        };
        this._animate(view, 0, 0, () => {
            this._mode = 'outside';
            // Restore the map's original vertical FOV (mapmax #24).
            if (this._savedFov != null && typeof this._map.setVerticalFieldOfView === 'function') {
                this._map.setVerticalFieldOfView(this._savedFov);
                this._savedFov = null;
            }
            for (const handler of this._interactionHandlers()) {
                handler.enable();
            }
            if (this._options.onExit) this._options.onExit();
        });
    }

    remove() {
        const map = this._map;
        const container = map.getContainer();
        container.removeEventListener('mousedown', this._onMouseDown);
        removeEventListener('mousemove', this._onMouseMove);
        removeEventListener('mouseup', this._onMouseUp);
        container.removeEventListener('touchstart', this._onTouchStart);
        container.removeEventListener('touchmove', this._onTouchMove);
        container.removeEventListener('touchend', this._onTouchEnd);
        if (map.getLayer(this._layer.id)) {
            map.removeLayer(this._layer.id);
        }
    }

    _interactionHandlers() {
        const map = this._map;
        return [map.dragPan, map.dragRotate, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard];
    }

    // Refactored image → texture load, reusable after the layer exists (not
    // only at creation). No-op until onAdd has stored the gl + layer context.
    _loadTexture(url, onReady) {
        const gl = this._gl;
        const layer = this._layerCtx;
        if (!gl || !layer) return;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, layer.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            layer.textureReady = true;
            this._map.triggerRepaint();
            if (onReady) onReady();
        };
        image.onerror = () => onReady && onReady(new Error(`photosphere image failed: ${url}`));
        image.src = url;
    }

    _createLayer() {
        const self = this;
        return {
            id: 'photosphere',
            type: 'custom',
            renderingMode: '2d',

            onAdd(map, gl) {
                const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
                const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
                this.program = gl.createProgram();
                gl.attachShader(this.program, vertexShader);
                gl.attachShader(this.program, fragmentShader);
                gl.linkProgram(this.program);
                if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                    throw new Error(gl.getProgramInfoLog(this.program));
                }

                this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
                this.uniforms = {};
                for (const name of ['uYaw', 'uPitch', 'uFovY', 'uAspect', 'uAlpha', 'uSphereCenterOffset', 'uSphereRadius', 'uPanorama', 'uEyeHeight', 'uArrowCount', 'uArrows']) {
                    this.uniforms[name] = gl.getUniformLocation(this.program, name);
                }

                this.vertexBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

                this.textureReady = false;
                this.texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
                // REPEAT horizontally so the equirectangular seam behind the
                // camera wraps seamlessly (WebGL2/NPOT — MapLibre 6). Clamp
                // vertically at the poles (mapmax #40).
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                self._gl = gl;
                self._layerCtx = this;
                self._loadTexture(self._options.imageUrl);
            },

            render(gl) {
                if (!this.textureReady || self._opacity <= 0) {
                    return;
                }
                gl.disable(gl.DEPTH_TEST);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.useProgram(this.program);

                gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
                gl.enableVertexAttribArray(this.aPosition);
                gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.uniform1i(this.uniforms.uPanorama, 0);
                gl.uniform1f(this.uniforms.uYaw, self._yawDeg * Math.PI / 180);
                gl.uniform1f(this.uniforms.uPitch, self._pitchDeg * Math.PI / 180);
                gl.uniform1f(this.uniforms.uFovY, self._options.fov * Math.PI / 180);
                gl.uniform1f(this.uniforms.uAspect, gl.drawingBufferWidth / gl.drawingBufferHeight);
                gl.uniform1f(this.uniforms.uAlpha, self._opacity * self._blend);
                gl.uniform3f(this.uniforms.uSphereCenterOffset, ...self._sphereCenterOffset);
                gl.uniform1f(this.uniforms.uSphereRadius, self._options.radius);

                // Ground navigation arrows (mapmax #26): positions on the floor,
                // at a fixed distance toward each target bearing.
                gl.uniform1f(this.uniforms.uEyeHeight, self._options.eyeHeight);
                const n = Math.min(MAX_ARROWS, self._navArrows.length);
                gl.uniform1i(this.uniforms.uArrowCount, n);
                const buf = new Float32Array(MAX_ARROWS * 2);
                for (let i = 0; i < n; i++) {
                    const br = self._navArrows[i].bearing * Math.PI / 180;
                    buf[i * 2] = ARROW_GROUND_DIST * Math.sin(br);
                    buf[i * 2 + 1] = ARROW_GROUND_DIST * Math.cos(br);
                }
                gl.uniform2fv(this.uniforms.uArrows, buf);

                gl.drawArrays(gl.TRIANGLES, 0, 3);
                gl.disable(gl.BLEND);
            }
        };
    }

    _recalibrateLookTargetDistance() {
        const { lngLat, zoom, eyeHeight } = this._options;
        const eyeMercator = MercatorCoordinate.fromLngLat(lngLat);
        const probeTarget = new MercatorCoordinate(
            eyeMercator.x, eyeMercator.y - eyeMercator.meterInMercatorCoordinateUnits()).toLngLat();
        const probeOptions = this._map.calculateCameraOptionsFromTo(lngLat, eyeHeight, probeTarget, eyeHeight);
        this._lookTargetDistanceMetres = Math.pow(2, probeOptions.zoom - zoom);
    }

    _updateCameraWhileInside() {
        const { lngLat, eyeHeight } = this._options;
        const eyeMercator = MercatorCoordinate.fromLngLat(lngLat);
        const metresToMercatorUnits = eyeMercator.meterInMercatorCoordinateUnits();

        const yawRad = this._yawDeg * Math.PI / 180;
        const pitchRad = this._pitchDeg * Math.PI / 180;
        const horizontalDistance = this._lookTargetDistanceMetres * Math.cos(pitchRad);
        const targetLngLat = new MercatorCoordinate(
            eyeMercator.x + horizontalDistance * Math.sin(yawRad) * metresToMercatorUnits,
            eyeMercator.y - horizontalDistance * Math.cos(yawRad) * metresToMercatorUnits
        ).toLngLat();

        const cameraOptions = this._map.calculateCameraOptionsFromTo(
            lngLat, eyeHeight, targetLngLat,
            eyeHeight + this._lookTargetDistanceMetres * Math.sin(pitchRad));
        this._map.jumpTo(cameraOptions);
    }

    _animate(targetView, targetElevation, targetOpacity, onDone) {
        const map = this._map;
        const startTime = performance.now();
        const start = {
            center: map.getCenter(),
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
            elevation: map.getCenterElevation(),
            opacity: this._opacity
        };
        const durationMs = this._options.durationMs;
        const anchor = this._options.lngLat;

        const step = (now) => {
            const t = Math.min(1, (now - startTime) / durationMs);
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            const eyeMercator = MercatorCoordinate.fromLngLat(map.getCenter());
            const sphereMercator = MercatorCoordinate.fromLngLat(anchor);
            const metresToMercatorUnits = sphereMercator.meterInMercatorCoordinateUnits();
            this._sphereCenterOffset = [
                (sphereMercator.x - eyeMercator.x) / metresToMercatorUnits,
                -(sphereMercator.y - eyeMercator.y) / metresToMercatorUnits,
                0
            ];
            this._opacity = start.opacity + (targetOpacity - start.opacity) * eased;

            map.jumpTo({
                center: [
                    start.center.lng + (targetView.center[0] - start.center.lng) * eased,
                    start.center.lat + (targetView.center[1] - start.center.lat) * eased
                ],
                zoom: start.zoom + (targetView.zoom - start.zoom) * eased,
                pitch: start.pitch + (targetView.pitch - start.pitch) * eased,
                bearing: start.bearing + (targetView.bearing - start.bearing) * eased,
                elevation: start.elevation + (targetElevation - start.elevation) * eased
            });
            map.triggerRepaint();

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                onDone();
            }
        };
        requestAnimationFrame(step);
    }

    _onMouseDown(event) {
        if (this._mode !== 'inside') {
            return;
        }
        this._dragging = true;
        this._lastX = event.clientX;
        this._lastY = event.clientY;
    }

    _onMouseMove(event) {
        if (!this._dragging) {
            return;
        }
        const { dragSensitivity, minPitch, maxPitch } = this._options;
        this._yawDeg = (this._yawDeg - (event.clientX - this._lastX) * dragSensitivity + 360) % 360;
        this._pitchDeg = Math.max(minPitch, Math.min(maxPitch,
            this._pitchDeg + (event.clientY - this._lastY) * dragSensitivity));
        this._lastX = event.clientX;
        this._lastY = event.clientY;
        this._updateCameraWhileInside();
        this._map.triggerRepaint();
    }

    _onMouseUp() {
        this._dragging = false;
    }

    // Touch: one finger looks around, two fingers pinch to zoom FOV (mapmax #7).
    _onTouchStart(event) {
        if (this._mode !== 'inside') return;
        if (event.touches.length === 1) {
            this._dragging = true;
            this._lastX = event.touches[0].clientX;
            this._lastY = event.touches[0].clientY;
        } else if (event.touches.length === 2) {
            this._dragging = false;
            this._pinchDist = this._touchDistance(event);
        }
    }

    _onTouchMove(event) {
        if (this._mode !== 'inside') return;
        event.preventDefault();
        const { dragSensitivity, minPitch, maxPitch } = this._options;
        if (event.touches.length === 1 && this._dragging) {
            const t = event.touches[0];
            this._yawDeg = (this._yawDeg - (t.clientX - this._lastX) * dragSensitivity + 360) % 360;
            this._pitchDeg = Math.max(minPitch, Math.min(maxPitch,
                this._pitchDeg + (t.clientY - this._lastY) * dragSensitivity));
            this._lastX = t.clientX;
            this._lastY = t.clientY;
            this._updateCameraWhileInside();
            this._map.triggerRepaint();
        } else if (event.touches.length === 2 && this._pinchDist) {
            const d = this._touchDistance(event);
            this.zoomFov((this._pinchDist - d) * 0.2);
            this._pinchDist = d;
        }
    }

    _onTouchEnd(event) {
        this._dragging = false;
        if (!event.touches || event.touches.length < 2) this._pinchDist = 0;
    }

    _touchDistance(event) {
        const [a, b] = event.touches;
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
}
