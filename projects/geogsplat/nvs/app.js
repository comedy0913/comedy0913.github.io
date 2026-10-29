import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const element = identifier => document.getElementById(identifier);
const state = { ready: false, decoded: false, warmupFrames: 0, playing: false, frame: 0, version: 0, cases: [], trajectory: null };
const panels = {};
let synchronization = false;
let pendingSelection = null;
let lastFrameTime = 0;
let needsRender = true;
let lastRenderTime = 0;
let visible = true;

if (new URLSearchParams(location.search).has('embed')) document.documentElement.classList.add('embedded');

new ResizeObserver(() => {
  if (window.parent !== window) window.parent.postMessage({ type: 'geogsplat-nvs-height', height: document.body.getBoundingClientRect().height }, location.origin);
}).observe(document.body);

new IntersectionObserver(entries => {
  visible = entries[0].isIntersecting;
  needsRender = true;
}).observe(document.querySelector('main'));

function notifyParent(selected) {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'geogsplat-nvs-case', id: selected.id, title: selected.title, level: selected.level }, location.origin);
  }
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || window.parent === window || event.source !== window.parent) return;
  if (event.data?.type !== 'geogsplat-nvs-select') return;
  const id = typeof event.data.id === 'string' ? event.data.id : '';
  if (!state.cases.some(record => record.id === id)) {
    pendingSelection = id;
    return;
  }
  if (element('scene').value === id) return;
  element('scene').value = id;
  loadCase().catch(showError);
});

function showError(error) {
  console.error(error);
  element('status').textContent = `${error.name || 'Error'}: ${error.message || error}`;
  element('status').classList.add('error');
}

function projection(camera, intrinsic) {
  const [fx, fy, cx, cy] = intrinsic;
  const near = 0.01;
  const far = 100;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(256 / (2 * fy)));
  camera.projectionMatrix.set(2 * fx / 256, 0, 1 - 2 * cx / 256, 0, 0, 2 * fy / 256, 2 * cy / 256 - 1, 0, 0, 0, -(far + near) / (far - near), -2 * far * near / (far - near), 0, 0, -1, 0);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function applyFrame(frame) {
  if (!state.trajectory) return;
  state.frame = Math.min(Math.max(Math.round(frame), 0), state.trajectory.cameras.length - 1);
  const matrix = new THREE.Matrix4().set(...state.trajectory.cameras[state.frame].flat()).multiply(new THREE.Matrix4().makeScale(1, -1, -1));
  synchronization = true;
  for (const panel of Object.values(panels)) {
    matrix.decompose(panel.camera.position, panel.camera.quaternion, panel.camera.scale);
    panel.camera.up.setFromMatrixColumn(matrix, 1);
    const direction = new THREE.Vector3();
    panel.camera.getWorldDirection(direction);
    panel.controls.target.copy(panel.camera.position).addScaledVector(direction, state.trajectory.orbitDistance);
    projection(panel.camera, state.trajectory.intrinsics[state.frame]);
    panel.camera.updateMatrixWorld(true);
  }
  synchronization = false;
  element('timeline').value = String(state.frame);
  element('frame-label').textContent = `${state.frame} / ${state.trajectory.cameras.length - 1}`;
  needsRender = true;
}

function pause() {
  state.playing = false;
  element('play').textContent = 'Play camera tour';
}

function createPanel(name) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(320, 320, false);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  element(`${name}-view`).append(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    state.ready = false;
    state.warmupFrames = 0;
    element('play').disabled = true;
    element('reset').disabled = true;
    element('status').textContent = 'Restoring the interactive renderer…';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { needsRender = true; });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  const spark = new SparkRenderer({ renderer, enableLod: false, onDirty: () => { needsRender = true; }, sortRadial: false, minAlpha: 1 / 255, preBlurAmount: 0.3, blurAmount: 0, maxStdDev: 3 });
  scene.add(spark);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minDistance = 0.02;
  controls.maxDistance = 100;
  const panel = { renderer, scene, camera, spark, controls, mesh: null, meshes: new Map() };
  panels[name] = panel;
  controls.addEventListener('start', pause);
  controls.addEventListener('change', () => {
    needsRender = true;
    if (synchronization) return;
    synchronization = true;
    for (const other of Object.values(panels)) {
      if (other === panel) continue;
      other.camera.position.copy(camera.position);
      other.camera.quaternion.copy(camera.quaternion);
      other.camera.up.copy(camera.up);
      other.controls.target.copy(controls.target);
      other.camera.updateMatrixWorld(true);
    }
    synchronization = false;
  });
}

for (const name of ['tokengs', 'ours']) {
  try {
    createPanel(name);
  } catch (error) {
    showError(error);
  }
}

async function loadCase() {
  const version = ++state.version;
  state.ready = false;
  state.decoded = false;
  state.warmupFrames = 0;
  pause();
  element('play').disabled = true;
  element('reset').disabled = true;
  element('status').classList.remove('error');
  element('status').textContent = 'Loading complete Gaussian appearance…';
  const selected = state.cases.find(record => record.id === element('scene').value);
  element('scene-title').textContent = selected.title;
  element('scene-level').textContent = selected.level;
  element('viewer-count').textContent = `${selected.counts.ours.full.toLocaleString('en-US')} Gaussians per method`;
  notifyParent(selected);
  element('context-note').textContent = `${selected.inputs} input views · Same inputs and cameras for both methods.`;
  element('input-images').replaceChildren(...(selected.inputFiles || []).map((filename, index) => {
    const image = new Image(50, 50);
    image.src = `${selected.base}${filename}`;
    image.alt = `Input view ${index + 1}`;
    return image;
  }));
  for (const name of ['tokengs', 'ours']) {
    element(`${name}-view`).classList.remove('ready');
    element(`${name}-poster`).src = `${selected.base}${name}-full-frame0.png`;
    element(`${name}-count`).textContent = '';
  }
  const response = await fetch(`${selected.base}${selected.trajectory}`);
  if (!response.ok) throw new Error('Camera trajectory could not load');
  const trajectory = await response.json();
  if (version !== state.version) return;
  state.trajectory = trajectory;
  element('timeline').max = String(state.trajectory.cameras.length - 1);
  applyFrame(0);
  await Promise.all(Object.entries(panels).map(async ([name, panel]) => {
    const url = `${selected.base}${name}-full.ply`;
    if (!panel.meshes.has(url)) {
      panel.meshes.set(url, (async () => {
        const mesh = new SplatMesh({ url, extSplats: true, enableLod: false, lod: false, nonLod: true });
        await mesh.initialized;
        mesh.splats?.setMaxSh(3);
        return mesh;
      })());
    }
    const mesh = await panel.meshes.get(url);
    if (version !== state.version) return;
    if (panel.mesh) panel.scene.remove(panel.mesh);
    panel.mesh = mesh;
    panel.scene.add(mesh);
    needsRender = true;
    element(`${name}-count`).textContent = `${selected.counts[name].full.toLocaleString('en-US')} Gaussians`;
  }));
  if (version !== state.version) return;
  state.decoded = Object.keys(panels).length === 2;
  if (!state.decoded) {
    element('status').textContent = 'Interactive rendering is unavailable on this device. Showing the rendered previews.';
    return;
  }
  element('status').textContent = 'Preparing Gaussian textures and depth sorting…';
  needsRender = true;
}

element('scene').addEventListener('change', () => loadCase().catch(showError));
element('timeline').addEventListener('input', () => { pause(); applyFrame(Number(element('timeline').value)); });
element('reset').addEventListener('click', () => { pause(); applyFrame(0); });
element('play').addEventListener('click', () => {
  state.playing = !state.playing;
  lastFrameTime = 0;
  element('play').textContent = state.playing ? 'Pause camera tour' : 'Play camera tour';
});

function animate(time) {
  if (!visible || document.hidden) {
    requestAnimationFrame(animate);
    return;
  }
  if (state.ready && state.playing && time - lastFrameTime >= 1000 / state.trajectory.fps) {
    applyFrame((state.frame + 1) % state.trajectory.cameras.length);
    lastFrameTime = time;
  }
  if (needsRender || time - lastRenderTime >= 500) {
    needsRender = false;
    for (const panel of Object.values(panels)) panel.renderer.render(panel.scene, panel.camera);
    lastRenderTime = time;
    if (state.decoded) state.warmupFrames += 1;
  }
  if (state.decoded && !state.ready && state.warmupFrames >= 3 && Object.values(panels).every(panel => !panel.renderer.getContext().isContextLost() && !panel.mesh.generatorDirty && !panel.spark.sorting && panel.spark.display.numSplats >= panel.mesh.splats.getNumSplats())) {
    state.ready = true;
    element('play').disabled = false;
    element('reset').disabled = false;
    for (const name of ['tokengs', 'ours']) element(`${name}-view`).classList.add('ready');
    state.playing = true;
    lastFrameTime = 0;
    element('play').textContent = 'Pause camera tour';
    element('status').textContent = 'Ready · both cameras synchronized · drag either panel to explore';
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

window.nvsDemo = { state, panels, applyFrame, pause };

try {
  const response = await fetch('cases.json');
  if (!response.ok) throw new Error('Scene catalog could not load');
  state.cases = await response.json();
  element('scene').replaceChildren(...state.cases.map(record => new Option(`${record.title} · ${record.level}`, record.id)));
  element('scene').disabled = false;
  if (pendingSelection && state.cases.some(record => record.id === pendingSelection)) element('scene').value = pendingSelection;
  pendingSelection = null;
  await loadCase();
} catch (error) {
  showError(error);
}
