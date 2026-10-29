const frame = document.getElementById('nvs-frame');
const strip = document.getElementById('nvs-strip');
const categories = document.getElementById('nvs-categories');

let cases = [];
let activeId = null;
let filterLevel = 'All';

function postSelection(id) {
  const target = frame.contentWindow;
  if (!target) return;
  target.postMessage({ type: 'geogsplat-nvs-select', id }, location.origin);
}

function markActive(id) {
  for (const chip of strip.querySelectorAll('.scene-chip')) {
    const active = chip.dataset.id === id;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  }
}

function selectCase(id) {
  if (!cases.some(record => record.id === id)) return;
  activeId = id;
  markActive(id);
  postSelection(id);
}

function buildChip(record) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `scene-chip${record.id === activeId ? ' active' : ''}`;
  chip.dataset.id = record.id;
  chip.dataset.level = record.level.replace('-level', '');
  chip.setAttribute('aria-pressed', String(record.id === activeId));
  chip.setAttribute('aria-label', `Show ${record.title} in the Gaussian comparison`);
  const image = new Image();
  image.src = `nvs/${record.base}ours-full-frame0.png`;
  image.alt = `GeoGSplat rendered preview: ${record.title}`;
  image.loading = 'lazy';
  image.decoding = 'async';
  const label = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = record.title;
  const small = document.createElement('small');
  small.textContent = record.level;
  label.append(strong, small);
  chip.append(image, label);
  chip.addEventListener('click', () => selectCase(record.id));
  return chip;
}

function renderStrip() {
  const visible = cases.filter(record => filterLevel === 'All' || record.level.startsWith(filterLevel));
  strip.replaceChildren(...visible.map(buildChip));
}

categories.addEventListener('click', event => {
  const button = event.target.closest('button[data-level]');
  if (!button) return;
  filterLevel = button.dataset.level;
  for (const option of categories.querySelectorAll('button')) {
    const active = option === button;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  }
  renderStrip();
});

frame.addEventListener('load', () => {
  if (activeId) postSelection(activeId);
});

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  const data = event.data;
  if (data?.type === 'geogsplat-nvs-height') {
    const height = Number(data.height);
    if (!Number.isFinite(height) || height < 300 || height > 1600) return;
    frame.style.height = `${Math.ceil(height)}px`;
    return;
  }
  if (data?.type === 'geogsplat-nvs-case' && typeof data.id === 'string' && cases.some(record => record.id === data.id)) {
    activeId = data.id;
    markActive(data.id);
  }
});

fetch('nvs/cases.json')
  .then(response => {
    if (!response.ok) throw new Error('Scene catalog could not load');
    return response.json();
  })
  .then(records => {
    cases = records;
    if (cases.length) activeId = cases[0].id;
    renderStrip();
    postSelection(activeId);
  })
  .catch(error => console.error(error));
