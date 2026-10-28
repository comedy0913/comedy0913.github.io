import { PointViewer, parseCloud } from './point-viewer.js';

const element = identifier => document.getElementById(identifier);
const benchmarkRows = [
  { name: 'MVSplat', dtu: [14.44, .520, .401, .166, '158K'], nrgbd: [18.53, .609, .319, .085, '255K'] },
  { name: 'DepthSplat', dtu: [15.46, .599, .331, .098, '158K'], nrgbd: [22.98, .792, .170, .076, '255K'] },
  { name: 'AnySplat', dtu: [16.60, .630, .166, .040, '170K'], nrgbd: [20.12, .690, .138, .055, '643K'] },
  { name: 'AnySplat*', dtu: [17.54, .700, .148, .025, '166K'], nrgbd: [20.52, .756, .140, .042, '624K'] },
  { name: 'VolSplat', dtu: [15.86, .602, .306, .063, '152K'], nrgbd: [22.22, .757, .216, .060, '246K'] },
  { name: 'TokenGS', dtu: [17.71, .643, .354, .082, '65K'], nrgbd: [23.82, .844, .173, .277, '65K'] },
  { name: 'GeoGSplat', dtu: [20.48, .771, .137, .018, '65K'], nrgbd: [24.78, .847, .120, .017, '65K'] },
];

function renderBenchmark(dataset) {
  const name = dataset === 'dtu' ? 'DTU' : 'NRGBD';
  element('benchmark-body').replaceChildren(...benchmarkRows.map(record => {
    const row = document.createElement('tr');
    if (record.name === 'GeoGSplat') row.className = 'ours';
    if (record.name === 'TokenGS') row.className = 'token';
    const method = document.createElement('th');
    method.scope = 'row';
    method.textContent = record.name;
    row.append(method);
    record[dataset].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = typeof value === 'number' ? value.toFixed(index === 0 ? 2 : 3) : value;
      row.append(cell);
    });
    return row;
  }));
  element('benchmark-caption').textContent = `${name} results with four input views`;
  element('benchmark-panel').setAttribute('aria-labelledby', `tab-${dataset}`);
  document.querySelectorAll('[data-benchmark]').forEach(button => {
    const selected = button.dataset.benchmark === dataset;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

document.querySelectorAll('[data-benchmark]').forEach(button => {
  button.addEventListener('click', () => renderBenchmark(button.dataset.benchmark));
  button.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const dataset = event.key === 'Home' ? 'dtu' : event.key === 'End' ? 'nrgbd' : button.dataset.benchmark === 'dtu' ? 'nrgbd' : 'dtu';
      renderBenchmark(dataset);
      element(`tab-${dataset}`).focus();
    }
  });
});
renderBenchmark('dtu');

element('copy-citation').addEventListener('click', async () => {
  const text = element('bibtex').textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('Clipboard unavailable');
    }
    element('copy-citation').textContent = 'Copied ✓';
    element('citation-status').textContent = 'Citation copied';
    setTimeout(() => { element('copy-citation').textContent = 'Copy ↗'; }, 2200);
  } catch {
    element('citation-status').textContent = 'Please select the citation text and copy it manually.';
    element('copy-citation').textContent = 'Select text to copy';
  }
});

let scenes = [];
let currentScene;
let sceneLevel = 'All';
let loadVersion = 0;
let loadController;
let viewer;
let tokenViewer;
const cloudCache = new Map();

function showViewerError(message) {
  element('viewer-status').textContent = message;
  element('viewer-status').classList.remove('ready');
  element('viewer-poster').classList.remove('loaded');
  element('point-canvas').style.visibility = 'hidden';
}

try { viewer = new PointViewer(element('point-canvas'), showViewerError); }
catch (error) { showViewerError(error.message); }

function showTokenError(message) {
  element('token-status').textContent = message;
  element('token-status').classList.remove('ready');
  element('token-poster').classList.remove('loaded');
  element('token-canvas').style.visibility = 'hidden';
}

try { tokenViewer = new PointViewer(element('token-canvas'), showTokenError); }
catch (error) { showTokenError(error.message); }

const comparisonActive = () => element('display-mode').value === 'comparison';
const cameraSettings = () => comparisonActive() ? currentScene.comparison : currentScene;

if (viewer && tokenViewer) {
  viewer.onCameraChange = (camera, span) => { if (comparisonActive()) tokenViewer.setCamera(camera, span); };
  tokenViewer.onCameraChange = (camera, span) => { if (comparisonActive()) viewer.setCamera(camera, span); };
}

function setSharedCamera(camera, span) {
  viewer?.setCamera(camera, span);
  if (comparisonActive()) tokenViewer?.setCamera(camera, span);
}

function configureDisplay() {
  if (!currentScene) return;
  const comparing = comparisonActive();
  const settings = cameraSettings();
  element('viewer-panes').classList.toggle('comparison-active', comparing);
  element('representation').disabled = comparing;
  element('camera-preset').replaceChildren(...settings.cameras.map((camera, index) => new Option(camera.name, String(index))));
  element('camera-preset').value = String(settings.defaultCamera);
  setSharedCamera(settings.cameras[settings.defaultCamera], settings.span);
  element('viewer-poster').src = `${currentScene.base}${comparing ? currentScene.comparison.oursPoster : 'poster.webp'}`;
  element('token-poster').src = `${currentScene.base}${currentScene.comparison.tokengsPoster}`;
  element('viewer-poster').classList.remove('loaded');
  element('token-poster').classList.remove('loaded');
  element('point-canvas').style.visibility = 'hidden';
  element('token-canvas').style.visibility = 'hidden';
  element('geometry-detail').textContent = comparing
    ? `${currentScene.comparison.inputViews} context views per method · All 65,536 Gaussian centers · Synchronized cameras`
    : `${currentScene.inputViews} input views · GeoGSplat reconstruction demonstration · All predicted points`;
  element('geometry-summary').textContent = comparing
    ? 'GeoGSplat and original TokenGS Gaussian centers. Both models use the same context views.'
    : 'Selected GeoGSplat reconstruction demonstration. Switch to comparison for the same-context baseline results.';
  element('geometry-protocol').textContent = comparing
    ? 'Both models use the same context views. All 65,536 Gaussian centers are shown in a shared coordinate system, without opacity filtering or point removal. Both sides use the same context-image color projection; unsupported points remain gray.'
    : 'This is a separate GeoGSplat reconstruction demonstration, not a baseline or novel view synthesis comparison. All predicted dense points or Gaussian centers are retained. Colors are projected from context images; unsupported points remain gray.';
}

function renderSceneStrip() {
  element('scene-strip').replaceChildren(...scenes.filter(scene => sceneLevel === 'All' || scene.level === sceneLevel).map(scene => {
    const button = document.createElement('button');
    button.className = `scene-chip${currentScene?.id === scene.id ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(currentScene?.id === scene.id));
    button.setAttribute('aria-label', `Explore ${scene.title}, ${scene.levelLabel}`);
    button.dataset.scene = scene.id;
    const image = document.createElement('img');
    image.src = `${scene.base}thumbnail.webp`;
    image.alt = `GeoGSplat rendered preview: ${scene.title}`;
    image.width = scene.previewSize.width;
    image.height = scene.previewSize.height;
    image.loading = 'lazy';
    const label = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = scene.title;
    const level = document.createElement('small');
    level.textContent = scene.levelLabel;
    label.append(title, level);
    button.append(image, label);
    button.addEventListener('click', () => selectScene(scene.id));
    return button;
  }));
}

async function loadGeometry() {
  if (!viewer || !currentScene) return;
  const version = ++loadVersion;
  loadController?.abort();
  loadController = new AbortController();
  const comparing = comparisonActive();
  const type = comparing ? 'centers' : element('representation').value;
  const path = `${currentScene.base}${comparing ? currentScene.comparison.ours : `${type}.gsp`}`;
  element('viewer-status').textContent = 'Loading geometry…';
  element('viewer-status').classList.remove('ready');
  if (comparing && tokenViewer) {
    element('token-status').textContent = 'Loading geometry…';
    element('token-status').classList.remove('ready');
  }
  try {
    const signal = loadController.signal;
    const loadCloud = async source => {
      let cloud = cloudCache.get(source);
      if (!cloud) {
        const response = await fetch(source, { signal });
        if (!response.ok) throw new Error(`Geometry could not load (${response.status})`);
        cloud = parseCloud(await response.arrayBuffer());
        cloudCache.set(source, cloud);
        if (cloudCache.size > 10) cloudCache.delete(cloudCache.keys().next().value);
      }
      return cloud;
    };
    const [cloud, baseline] = await Promise.all([
      loadCloud(path),
      comparing && tokenViewer ? loadCloud(`${currentScene.base}${currentScene.comparison.tokengs}`) : Promise.resolve(null),
    ]);
    if (version !== loadVersion) return;
    viewer.upload(cloud);
    element('point-canvas').style.visibility = 'visible';
    element('viewer-poster').classList.add('loaded');
    element('viewer-status').textContent = 'Geometry ready';
    element('viewer-status').classList.add('ready');
    if (baseline) {
      tokenViewer.upload(baseline);
      element('token-canvas').style.visibility = 'visible';
      element('token-poster').classList.add('loaded');
      element('token-status').textContent = 'Geometry ready';
      element('token-status').classList.add('ready');
    }
    element('viewer-count').textContent = `${cloud.count.toLocaleString('en-US')} ${comparing ? 'centers per method' : type === 'dense' ? 'dense points' : 'Gaussian centers'}`;
  } catch (error) {
    if (error.name !== 'AbortError' && version === loadVersion) {
      showViewerError(`${error.message}. Select the scene again to retry.`);
      if (comparing) showTokenError('Comparison unavailable. Select the scene again to retry.');
    }
  }
}

function selectScene(identifier) {
  const scene = scenes.find(record => record.id === identifier);
  if (!scene) return;
  currentScene = scene;
  element('viewer-title').textContent = scene.title;
  element('viewer-level').textContent = scene.levelLabel;
  element('viewer-poster').alt = `${scene.title} point-cloud preview`;
  element('token-poster').alt = `TokenGS Gaussian centers: ${scene.title}`;
  configureDisplay();
  element('input-thumbnails').replaceChildren(...scene.inputs.map((path, index) => {
    const image = document.createElement('img');
    image.src = `${scene.base}${path}`;
    image.alt = `${scene.title}: observed image ${index + 1}`;
    return image;
  }));
  renderSceneStrip();
  loadGeometry();
}

document.querySelectorAll('[data-level]').forEach(button => {
  button.addEventListener('click', () => {
    sceneLevel = button.dataset.level;
    document.querySelectorAll('[data-level]').forEach(item => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    if (sceneLevel !== 'All' && currentScene.level !== sceneLevel) selectScene(scenes.find(scene => scene.level === sceneLevel).id);
    else renderSceneStrip();
  });
});

element('representation').addEventListener('change', loadGeometry);
element('display-mode').addEventListener('change', () => { configureDisplay(); loadGeometry(); });
element('camera-preset').addEventListener('change', () => {
  if (!currentScene) return;
  const settings = cameraSettings();
  setSharedCamera(settings.cameras[Number(element('camera-preset').value)], settings.span);
});
element('point-size').addEventListener('input', event => {
  const size = Number(event.target.value);
  element('point-size-value').value = `${size.toFixed(1)} px`;
  if (viewer) { viewer.pointSize = size; viewer.dirty = true; }
  if (tokenViewer) { tokenViewer.pointSize = size; tokenViewer.dirty = true; }
});
element('auto-rotate').addEventListener('click', () => {
  if (!viewer) return;
  viewer.autoRotate = !viewer.autoRotate;
  element('auto-rotate').setAttribute('aria-pressed', String(viewer.autoRotate));
  element('auto-rotate').title = viewer.autoRotate ? 'Turn auto-rotation off' : 'Turn auto-rotation on';
});
for (const identifier of ['point-canvas', 'token-canvas']) {
  element(identifier).addEventListener('manualorbit', () => {
    if (viewer) viewer.autoRotate = false;
    if (tokenViewer) tokenViewer.autoRotate = false;
    element('auto-rotate').setAttribute('aria-pressed', 'false');
  });
}
element('reset-camera').addEventListener('click', () => {
  if (!currentScene || !viewer) return;
  viewer.autoRotate = false;
  element('auto-rotate').setAttribute('aria-pressed', 'false');
  const settings = cameraSettings();
  element('camera-preset').value = String(settings.defaultCamera);
  setSharedCamera(settings.cameras[settings.defaultCamera], settings.span);
});
element('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (element('viewer-shell').requestFullscreen) await element('viewer-shell').requestFullscreen();
    else { element('viewer-status').textContent = 'Fullscreen is not supported in this browser.'; element('viewer-status').classList.remove('ready'); }
  } catch { element('fullscreen').title = 'Fullscreen was not allowed by the browser'; }
});
document.addEventListener('fullscreenchange', () => {
  element('fullscreen').title = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
  if (viewer) viewer.dirty = true;
  if (tokenViewer) tokenViewer.dirty = true;
});

async function initialize() {
  try {
    const response = await fetch('assets/scenes.json');
    if (!response.ok) throw new Error(`Scene catalog could not load (${response.status})`);
    scenes = await response.json();
    selectScene('dtu_00101');
  } catch (error) { showViewerError(`${error.message}. Please serve the page over HTTP rather than opening the file directly.`); }
}

initialize();
