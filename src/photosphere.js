// Photosphere rendering inside the MapLibre scene.
//
// A three.js scene shares MapLibre's WebGL context through a custom layer.
// The sphere (full for equirectangular pictures, partial patch for flat ones)
// is centered on the camera; its orientation is driven every frame by the map
// camera (bearing/pitch/fov), so vector layers drawn after this layer stay in
// sync with the photo — one camera, one projection.
import * as THREE from 'three';
import { crossfadeAt, easeInOutCubic } from './transition.js';

export const LAYER_ID = 'mapmax-photosphere';
const SPHERE_RADIUS = 80;

// Maps picture heading to three.js sphere yaw (see geometry derivation in
// the module tests/notes): image center faces `heading` when
// rotation.y = -rad(heading) - PI/2 + yawOffset. yawOffset is a calibration
// nudge adjustable at runtime ('[' / ']') and persisted locally.
let yawOffset = parseFloat(localStorage.getItem('mapmax.yawOffset') || '0');

export function nudgeYawOffset(deltaDeg) {
  yawOffset += (deltaDeg * Math.PI) / 180;
  localStorage.setItem('mapmax.yawOffset', String(yawOffset));
  console.info(`Photosphere yaw offset: ${((yawOffset * 180) / Math.PI).toFixed(1)}°`);
}

class PhotosphereLayer {
  constructor() {
    this.id = LAYER_ID;
    this.type = 'custom';
    this.renderingMode = '3d';
    this.visible = false;
    this.meshes = [];
  }

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.clearMeshes();
    this.renderer.dispose();
  }

  clearMeshes() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.map?.dispose();
      m.material.dispose();
    }
    this.meshes = [];
  }

  // Builds the mesh for a picture: full sphere for 360, curved patch for flat.
  makeMesh(texture, pic) {
    let geom;
    if (pic.type === 'equirectangular') {
      geom = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 32);
    } else {
      const img = texture.image;
      const hfov = ((pic.hfov || 70) * Math.PI) / 180;
      const vfov = img && img.width ? hfov * (img.height / img.width) : hfov * 0.75;
      geom = new THREE.SphereGeometry(
        SPHERE_RADIUS, 64, 32,
        Math.PI - hfov / 2, hfov,
        Math.PI / 2 - vfov / 2, vfov
      );
    }
    geom.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.y = -(pic.heading * Math.PI) / 180 - Math.PI / 2 + yawOffset;
    mesh.renderOrder = this.meshes.length;
    return mesh;
  }

  render() {
    if (!this.visible || this.meshes.length === 0) return;
    const tr = this.map.transform;
    const canvas = this.map.getCanvas();

    this.camera.fov = tr.fov;
    this.camera.aspect = canvas.width / canvas.height;
    this.camera.updateProjectionMatrix();
    // bearing/pitch → camera orientation (derivations in PR description)
    this.camera.rotation.y = -(this.map.getBearing() * Math.PI) / 180;
    this.camera.rotation.x = ((this.map.getPitch() - 90) * Math.PI) / 180;

    for (const m of this.meshes) m.rotation.y = m.userData.baseYaw ?? m.rotation.y;

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
}

export const photosphere = new PhotosphereLayer();

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

export function loadTexture(url) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

// Adds the custom layer under roads/buildings/labels so vector data can be
// mixed on top of the photo (SPECIFICATIONS.md §2.7).
export function addPhotosphereLayer(map) {
  if (map.getLayer(LAYER_ID)) return;
  const layers = map.getStyle().layers;
  const before = layers.find((l) => /^(tunnel|road|bridge|building)/.test(l.id));
  map.addLayer(photosphere, before && before.id);
}

// Shows `pic` in the sphere: quick SD texture first, HD swapped in when ready.
export async function showPicture(pic) {
  const sdUrl = pic.assets.sd || pic.assets.hd || pic.assets.thumb;
  const tex = await loadTexture(sdUrl);
  photosphere.clearMeshes();
  const mesh = photosphere.makeMesh(tex, pic);
  mesh.userData.baseYaw = mesh.rotation.y;
  photosphere.scene.add(mesh);
  photosphere.meshes.push(mesh);
  photosphere.visible = true;
  photosphere.map?.triggerRepaint();
  upgradeToHD(mesh, pic, sdUrl);
  return mesh;
}

function upgradeToHD(mesh, pic, currentUrl) {
  if (!pic.assets.hd || pic.assets.hd === currentUrl) return;
  loadTexture(pic.assets.hd)
    .then((hdTex) => {
      if (!photosphere.meshes.includes(mesh)) return hdTex.dispose();
      mesh.material.map?.dispose();
      mesh.material.map = hdTex;
      mesh.material.needsUpdate = true;
      photosphere.map?.triggerRepaint();
    })
    .catch(() => {});
}

// Continuous-movement transition to `toPic` (SPECIFICATIONS.md §2.4): the old
// sphere is pushed backward along the travel bearing (the camera "walks"
// forward through it) while the target cross-fades in from a slight zoom.
export async function transitionToPicture(toPic, plan) {
  const ps = photosphere;
  const oldMesh = ps.meshes[ps.meshes.length - 1];
  if (!oldMesh) return showPicture(toPic);

  const sdUrl = toPic.assets.sd || toPic.assets.hd || toPic.assets.thumb;
  const tex = await loadTexture(sdUrl);
  const target = ps.makeMesh(tex, toPic);
  target.userData.baseYaw = target.rotation.y;
  target.material.opacity = 0;
  target.renderOrder = oldMesh.renderOrder + 1;
  ps.scene.add(target);
  ps.meshes.push(target);

  const bearingRad = (plan.bearing * Math.PI) / 180;
  const dirX = Math.sin(bearingRad);
  const dirZ = -Math.cos(bearingRad);
  const maxOffset = SPHERE_RADIUS * plan.dolly;

  await new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / plan.duration);
      const e = easeInOutCubic(t);
      const { oldOpacity, newOpacity, newScale } = crossfadeAt(e, plan);
      oldMesh.position.set(-dirX * maxOffset * e, 0, -dirZ * maxOffset * e);
      oldMesh.material.opacity = oldOpacity;
      target.material.opacity = newOpacity;
      target.scale.setScalar(newScale);
      ps.map?.triggerRepaint();
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  ps.scene.remove(oldMesh);
  oldMesh.geometry.dispose();
  oldMesh.material.map?.dispose();
  oldMesh.material.dispose();
  ps.meshes = [target];
  target.scale.setScalar(1);
  target.material.opacity = 1;
  ps.map?.triggerRepaint();
  upgradeToHD(target, toPic, sdUrl);
  return target;
}

export function hidePhotosphere() {
  photosphere.visible = false;
  photosphere.clearMeshes();
  photosphere.map?.triggerRepaint();
}
