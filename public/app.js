// QuickDrop — Explorer-style shared drop zone. Core shell; features live in /modules.
const $ = s => document.querySelector(s);
const content = $('#content'), canvas = $('#canvas'), menu = $('#menu'), modal = $('#modal'), win = $('#win');

const APP = 'QuickDrop';
const TRASH = 'trash', BIN_NAME = 'Recycle Bin';
const CELL_W = 96, CELL_H = 112, PAD = 12, ITEM_W = 88, ITEM_H = 100;

const state = { items: new Map(), quota: 0, used: 0, version: 0, modules: [] };
let cwd = null;                    // current folder id (null = root)
const sel = new Set();
const els = new Map();             // item id -> element
const pending = new Map();         // upload tid -> placeholder
let filter = '';
let dragging = false, renaming = false, refreshQueued = false;
let busyText = '';

// ---------------- icons ----------------
const P = {
  back: 'M16 10H4m5-5-5 5 5 5', forward: 'M4 10h12m-5-5 5 5-5 5', up: 'M10 16V4m-5 5 5-5 5 5',
  refresh: 'M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3h-3',
  chevR: 'M8 5l5 5-5 5', chevD: 'M5 8l5 5 5-5',
  search: 'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12.5 12.5 17 17',
  newfolder: 'M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5L9 5.5h7a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5zM10 8.5v5M7.5 11h5',
  folder: 'M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5L9 5.5h7a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z',
  upload: 'M10 13V3.5m-4 4 4-4 4 4M3.5 13v3h13v-3',
  download: 'M10 3.5V13m-4-4 4 4 4-4M3.5 13v3h13v-3',
  rename: 'M3 6.5h8M3 13.5h6M14.5 4v12M12.5 4h4M12.5 16h4',
  delete: 'M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.8 10.5h7.4l.8-10.5M8.5 8.5v5M11.5 8.5v5',
  arrange: 'M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z',
  min: 'M4 10h12', max: 'M4.5 4.5h11v11h-11z', restore: 'M6.5 6.5h9v9h-9zM4.5 13.5v-9h9', close: 'M5 5l10 10M15 5 5 15',
  plus: 'M10 4v12M4 10h12', check: 'M4.5 10.5l3.5 3.5 7.5-8',
  eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z',
  drive: 'M3 11.5h14v4.5H3zM5 4h10l2 7.5H3zM14 13.75h.5',
  open: 'M2.5 15V5.5A1.5 1.5 0 0 1 4 4h3.5L9 5.5h6a1.5 1.5 0 0 1 1.5 1.5v1.5M2.5 15l2.3-5.6a1 1 0 0 1 .9-.6H17a.8.8 0 0 1 .7 1.1L15.5 15z',
  settings: (() => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      for (const [r, d] of [[6.1, -0.3], [8.3, -0.17], [8.3, 0.17], [6.1, 0.3]]) pts.push([10 + r * Math.cos(a + d), 10 + r * Math.sin(a + d)]);
    }
    return 'M' + pts.map(([x, y]) => x.toFixed(2) + ' ' + y.toFixed(2)).join('L') + 'zM12.6 10a2.6 2.6 0 1 0-5.2 0 2.6 2.6 0 0 0 5.2 0z';
  })(),
  edit: 'M12.5 4.5l3 3L7 16H4v-3zM10.5 6.5l3 3',
  zip: 'M5 2.5h7l3.5 3.5v11.5h-10.5zM9 3v1.5M10 5.5v1.5M9 8v1.5M10 10.5V12M8.5 13h2v2.5h-2z',
  extract: 'M3 8h14v8.5H3zM2.5 4.5h15V8h-15zM10 10v5m-2-2 2 2 2-2',
  notepad: 'M5 2.5h7l3.5 3.5v11.5h-10.5zM7.5 9h5M7.5 12h5M7.5 15h3',
  paint: 'M16 3.5c-1.5 0-6 4.5-7.5 6.5L10 11.5c2-1.5 6.5-6 6.5-7.5a.5.5 0 0 0-.5-.5zM8 10.5c-2 0-3 1.5-3 3 0 1-1 2-2 2 1.5 1.5 6 1.5 6.5-2.5',
  image: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5h.01',
  save: 'M4 3.5h9.5L16.5 6.5v10h-12.5zM7 3.5v4h6v-4M7 16.5v-5h6v5',
  undo: 'M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 0 1 0 9H9',
  convert: 'M4 7h11.5m-3-3 3 3-3 3M16 13H4.5m3-3-3 3 3 3',
  help: 'M10 2.75a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5zM7.9 7.9a2.15 2.15 0 1 1 3 2c-.6.3-.9.8-.9 1.4v.4M10 14h.01',
};
const svg = (name, extra = '') =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ${extra}><path d="${P[name] || ''}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = svg(el.dataset.icon); });

const FOLDER_SVG = full => `<svg viewBox="0 0 64 64">
  <path d="M4 14a4 4 0 0 1 4-4h15l6 6h27a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#E8A720"/>
  ${full ? '<rect x="10" y="15" width="42" height="22" rx="1" fill="#fff"/><path d="M15 21h22M15 26h28" stroke="#cfd3d8" stroke-width="2"/>' : ''}
  <path d="M4 24a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#FFCB45"/>
  <path d="M4 24a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v1H4z" fill="#FFD969"/></svg>`;
const MINI_FOLDER = `<svg viewBox="0 0 64 64"><path d="M4 14a4 4 0 0 1 4-4h15l6 6h27a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#E8A720"/><path d="M4 24a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#FFCB45"/></svg>`;
const BIN_SVG = full => `<svg viewBox="0 0 64 64">
  ${full ? '<path d="M17 15l5-9 9 4 7-6 8 9z" fill="#fff" stroke="#b9c3cc"/><path d="M26 14l3-7 10 2-2 6z" fill="#ffe08a" stroke="#d4b25a"/><path d="M36 15l6-6 5 6z" fill="#cfe8ff" stroke="#8fb0d0"/>' : ''}
  <path d="M14 18h36l-3.5 38a4 4 0 0 1-4 3.6H21.5a4 4 0 0 1-4-3.6z" fill="#d6e7f7" fill-opacity=".9" stroke="#7a9bbd" stroke-width="1.5"/>
  <path d="M24 25l1.4 28M32 25v28M40 25l-1.4 28" stroke="#9dbad6" stroke-width="2.2" stroke-linecap="round"/>
  <rect x="11" y="13" width="42" height="6" rx="2.5" fill="#eaf2fb" stroke="#7a9bbd" stroke-width="1.5"/></svg>`;
const DRIVE_ICON = `<svg viewBox="0 0 20 20"><path d="M5 4h10l2 7.5H3z" fill="#9fb4c8"/><rect x="3" y="11" width="14" height="5" rx="1" fill="#5a7894"/><rect x="13" y="13" width="2" height="1.2" fill="#7CFC9A"/></svg>`;

const TYPES = [
  ['#D93025', 'pdf'],
  ['#2B579A', 'doc docx odt rtf pages'],
  ['#217346', 'xls xlsx xlsm csv ods numbers'],
  ['#D24726', 'ppt pptx odp key'],
  ['#B8860B', 'zip rar 7z tar gz tgz bz2 xz iso'],
  ['#0078D4', 'jpg jpeg png gif webp bmp heic heif tif tiff svg avif ico raw cr2 nef dng psd'],
  ['#8E44AD', 'mp4 mov mkv avi webm m4v wmv flv 3gp'],
  ['#E67E22', 'mp3 wav flac m4a aac ogg opus wma'],
  ['#00897B', 'js ts mjs jsx tsx py rb go rs java c cpp h cs php html htm css scss json xml yml yaml sh ps1 bat sql toml ini'],
  ['#4B5563', 'exe msi apk dmg deb rpm appimage app'],
  ['#6B7280', 'txt md log'],
];
const TYPE_COLOR = {};
TYPES.forEach(([c, exts]) => exts.split(' ').forEach(e => (TYPE_COLOR[e] = c)));
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fileSvg(name) {
  const ext = extOf(name);
  const label = ext.slice(0, 4).toUpperCase();
  const color = TYPE_COLOR[ext] || '#6B7280';
  const w = Math.max(24, label.length * 7 + 8);
  return `<svg viewBox="0 0 64 64">
    <path d="M14 4h26l14 14v40a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="var(--page)" stroke="var(--page-stroke)"/>
    <path d="M40 4v12a2 2 0 0 0 2 2h12" fill="var(--page-fold)" stroke="var(--page-stroke)"/>
    ${label ? `<rect x="7" y="34" width="${w}" height="15" rx="2" fill="${color}"/>
    <text x="${7 + w / 2}" y="45" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" font-family="Segoe UI,Arial,sans-serif">${esc(label)}</text>` :
    '<path d="M20 26h24M20 32h24M20 38h18" stroke="var(--page-stroke)" stroke-width="2" opacity=".5"/>'}
  </svg>`;
}

const IMG_EXT = new Set('jpg jpeg png gif webp bmp avif ico svg'.split(' '));
const VID_EXT = new Set('mp4 webm mov m4v ogv'.split(' '));
const AUD_EXT = new Set('mp3 wav m4a aac ogg oga opus flac'.split(' '));
const TEXT_EXT = new Set('txt md markdown log csv tsv json xml yml yaml ini toml conf cfg env js mjs cjs ts jsx tsx py rb go rs java kt c h cpp hpp cs php sh bash zsh ps1 bat cmd sql css scss less html htm srt vtt gitignore dockerfile'.split(' '));
const isText = it => it?.type === 'file' && (TEXT_EXT.has(extOf(it.name)) || /^text\//.test(it.mime || '') || it.mime === 'application/json');
// ?v=<mtime> makes every URL immutable, so edited files get fresh thumbnails
const fileUrl = (it, inline) => `/api/files/${encodeURIComponent(it.id)}?v=${it.mtime || 0}${inline ? '&inline=1' : ''}`;
function thumbKind(it) {
  const ext = extOf(it.name);
  if (IMG_EXT.has(ext)) return 'image';
  if (VID_EXT.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return null;
}

// PDF first-page thumbnails (pdf.js loaded on demand)
let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjs;
}
const pdfCache = new Map();
let pdfActive = 0; const pdfWait = [];
function pdfThumb(it) {
  const key = it.id + ':' + it.mtime;
  if (pdfCache.has(key)) return pdfCache.get(key);
  const p = (async () => {
    if (pdfActive >= 2) await new Promise(r => pdfWait.push(r));
    pdfActive++;
    try {
      await loadPdfjs();
      const task = pdfjs.getDocument({ url: fileUrl(it, true), isEvalSupported: false });
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const scale = (64 * (window.devicePixelRatio || 1)) / Math.max(v1.width, v1.height);
      const viewport = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
      await page.render({ canvas: c, viewport }).promise;
      const url = c.toDataURL('image/png');
      task.destroy();
      return url;
    } finally {
      pdfActive--; pdfWait.shift()?.();
    }
  })();
  pdfCache.set(key, p);
  p.catch(() => {});
  return p;
}

function buildIcon(it) {
  const box = document.createElement('div');
  box.className = 'icon';
  if (it.type === 'folder') { box.innerHTML = FOLDER_SVG(hasChildren(it.id)); return box; }
  const fallback = () => { box.innerHTML = fileSvg(it.name); };
  const kind = thumbKind(it);
  if (kind === 'image') {
    const img = new Image();
    img.className = 'thumb'; img.decoding = 'async'; img.loading = 'lazy'; img.draggable = false;
    img.onerror = fallback;
    img.src = fileUrl(it, true);
    box.append(img);
  } else if (kind === 'video') {
    const v = document.createElement('video');
    v.className = 'thumb video'; v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onerror = fallback;
    v.src = fileUrl(it, true) + '#t=0.5';
    box.append(v);
    box.insertAdjacentHTML('beforeend', `<span class="play-badge"><svg viewBox="0 0 10 10"><path d="M3 2l5 3-5 3z" fill="#fff"/></svg></span>`);
  } else if (kind === 'pdf') {
    fallback();
    pdfThumb(it).then(url => {
      const img = new Image(); img.className = 'thumb'; img.src = url; img.draggable = false;
      box.replaceChildren(img);
    }).catch(() => {});
  } else fallback();
  return box;
}

// ---------------- helpers ----------------
function fmt(b) {
  const u = ['bytes', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${i ? (b < 100 ? +b.toFixed(1) : Math.round(b)) : b} ${u[i]}`;
}
const children = parent => [...state.items.values()].filter(i => i.parent === parent);
const hasChildren = id => [...state.items.values()].some(i => i.parent === id);
const folderName = id => (id === TRASH ? BIN_NAME : id ? state.items.get(id)?.name ?? '' : APP);
function inTrash(id) {
  for (let a = id, n = 0; a && n < 1000; n++) {
    const it = state.items.get(a);
    if (!it) return false;
    if (it.parent === TRASH) return true;
    a = it.parent;
  }
  return false;
}
const trashBytes = () => [...state.items.values()].filter(i => inTrash(i.id)).reduce((s, i) => s + (i.size || 0), 0);
function pathTo(id) {
  const out = [], seen = new Set();
  for (let a = id; a && !seen.has(a); a = state.items.get(a)?.parent) {
    const it = state.items.get(a);
    if (!it) break;
    seen.add(a); out.unshift(it);
  }
  return out;
}
const inflightBytes = () => [...pending.values()].reduce((s, p) => s + p.total, 0);
const freeBytes = () => Math.max(0, state.quota - state.used - inflightBytes());
const selectedItems = () => [...sel].map(id => state.items.get(id)).filter(Boolean);

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Request failed (${r.status})`), { status: r.status, data: d });
  return d;
}

function contentPoint(e) {
  const r = content.getBoundingClientRect();
  return { x: e.clientX - r.left + content.scrollLeft, y: e.clientY - r.top + content.scrollTop };
}
const viewWidth = () => Math.max(CELL_W + PAD, content.clientWidth);
const gridCols = () => Math.max(1, Math.floor((viewWidth() - PAD) / CELL_W));

function occupied(parent) {
  return children(parent).map(i => ({ x: i.x, y: i.y }))
    .concat([...pending.values()].filter(p => p.parent === parent).map(p => ({ x: p.x, y: p.y })));
}
const clash = (occ, x, y) => occ.some(o => Math.abs(o.x - x) < ITEM_W - 8 && Math.abs(o.y - y) < ITEM_H - 8);
// Free grid cells in a folder (row-major), skipping occupied spots
function freeSpots(parent, n, extraOcc = []) {
  const occ = occupied(parent).concat(extraOcc);
  const cols = gridCols();
  const spots = [];
  for (let k = 0; spots.length < n && k < 100000; k++) {
    const x = PAD + (k % cols) * CELL_W, y = PAD + Math.floor(k / cols) * CELL_H;
    if (!clash(occ, x, y)) { spots.push({ x, y }); occ.push({ x, y }); }
  }
  return spots;
}
// A free spot next to an item (right, below, left, above, then further out)
function spotNear(item, extraOcc = []) {
  const occ = occupied(item.parent).concat(extraOcc);
  for (let r = 1; r <= 4; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
      const x = item.x + dx * CELL_W, y = item.y + dy * CELL_H;
      if (x >= 0 && y >= 0 && x + ITEM_W <= Math.max(viewWidth(), item.x + ITEM_W) && !clash(occ, x, y)) return { x, y };
    }
  }
  return freeSpots(item.parent, 1)[0];
}
// A block of n spots starting at the drop point
function blockAt(pt, n) {
  const x0 = Math.max(0, Math.round(pt.x - ITEM_W / 2)), y0 = Math.max(0, Math.round(pt.y - 36));
  const cols = Math.max(1, Math.min(n, Math.floor((viewWidth() - x0) / CELL_W) || 1, Math.ceil(Math.sqrt(n * 2))));
  return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * CELL_W, y: y0 + Math.floor(i / cols) * CELL_H }));
}
const gridSpots = n => {
  const cols = gridCols();
  return Array.from({ length: n }, (_, i) => ({ x: PAD + (i % cols) * CELL_W, y: PAD + Math.floor(i / cols) * CELL_H }));
};

// ---------------- state & sync ----------------
async function load() {
  try {
    const d = await api('GET', '/api/state');
    state.items = new Map(d.items.map(i => [i.id, i]));
    state.quota = d.quota; state.used = d.used; state.version = d.version; state.modules = d.modules || [];
    await syncModules();
    if (cwd && cwd !== TRASH && (!state.items.has(cwd) || inTrash(cwd))) { location.hash = '#/'; return; }
    for (const id of sel) if (!state.items.has(id)) sel.delete(id);
    for (const m of active) m.inst.onState?.();
    render();
  } catch (e) { console.warn(e); }
}
function refresh() {
  if (dragging || renaming) { refreshQueued = true; return; }
  refreshQueued = false;
  load();
}
function flushRefresh() { if (refreshQueued) refresh(); }

let es;
function connect() {
  es = new EventSource('/api/events');
  es.onmessage = e => { if (Number(e.data) !== state.version) refresh(); };
}
connect();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// ---------------- modules ----------------
const loaded = new Map();   // id -> instance
let active = [];            // enabled + loaded, in order
let syncing = Promise.resolve();
function syncModules() {
  syncing = syncing.then(async () => {
    for (const m of state.modules) {
      if (!m.enabled || loaded.has(m.id)) continue;
      try {
        if (m.hasCss) {
          const l = document.createElement('link');
          l.rel = 'stylesheet'; l.href = `/modules/${m.id}/client.css`;
          document.head.append(l);
        }
        const mod = await import(`/modules/${m.id}/client.js`);
        loaded.set(m.id, mod.default(host) || {});
      } catch (e) { console.warn(`module ${m.id} failed to load`, e); }
    }
    const was = active;
    active = state.modules.filter(m => m.enabled && loaded.has(m.id)).map(m => ({ ...m, inst: loaded.get(m.id) }));
    for (const m of was) if (!active.some(a => a.id === m.id)) m.inst.disable?.();
    for (const m of active) if (!was.some(a => a.id === m.id)) m.inst.enable?.();
  });
  return syncing;
}
const moduleEntries = (hook, ...args) => cwd === TRASH ? [] : active.flatMap(m => m.inst[hook]?.(...args) || []);

// ---------------- render ----------------
function render() {
  renderContent();
  renderNav();
  renderAddress();
  renderStatus();
  renderCommands();
}

function renderContent() {
  let list = children(cwd);
  const seen = new Set();
  let maxX = 0, maxY = 0;
  // The Recycle Bin is laid out newest first on a grid; icons there don't move.
  const binLayout = new Map();
  if (cwd === TRASH) {
    list = list.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0) || a.name.localeCompare(b.name));
    gridSpots(list.length).forEach((p, i) => binLayout.set(list[i].id, p));
  }
  for (const it of list) {
    seen.add(it.id);
    let el = els.get(it.id);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = it.id;
      el.draggable = true;
      el.innerHTML = '<div class="label"></div>';
      els.set(it.id, el);
      canvas.append(el);
    }
    const sig = it.type === 'folder' ? 'f' + hasChildren(it.id) : 'F' + extOf(it.name) + it.mtime;
    if (el._sig !== sig) {
      el._sig = sig;
      el.querySelector('.icon')?.remove();
      el.prepend(buildIcon(it));
    }
    el.className = 'item ' + it.type + (sel.has(it.id) ? ' sel' : '') +
      (filter && !it.name.toLowerCase().includes(filter) ? ' hidden' : '') +
      (el.classList.contains('drag-src') ? ' drag-src' : '');
    const at = binLayout.get(it.id) || it;
    el.style.left = at.x + 'px';
    el.style.top = at.y + 'px';
    el.draggable = cwd !== TRASH;
    const label = el.querySelector('.label');
    if (label && label.textContent !== it.name) label.textContent = it.name;
    el.title = it.type === 'file'
      ? `${it.name}\nSize: ${fmt(it.size)}\nDate modified: ${new Date(it.mtime).toLocaleString()}`
      : it.name;
    maxX = Math.max(maxX, at.x); maxY = Math.max(maxY, at.y);
  }
  for (const p of pending.values()) {
    if (p.parent !== cwd) continue;
    const key = 'p:' + p.tid;
    seen.add(key);
    let el = els.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'item uploading';
      const icon = document.createElement('div');
      icon.className = 'icon';
      if (p.preview) icon.innerHTML = `<img class="thumb" src="${p.preview}">`; else icon.innerHTML = fileSvg(p.name);
      el.append(icon);
      el.insertAdjacentHTML('beforeend', `<div class="label">${esc(p.name)}</div><div class="progress"><span></span></div>`);
      els.set(key, el);
      canvas.append(el);
    }
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    el.querySelector('.progress > span').style.width = (p.total ? (p.loaded / p.total) * 100 : 0) + '%';
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  for (const [k, el] of els) if (!seen.has(k)) { el.remove(); els.delete(k); }
  canvas.style.width = maxX + CELL_W + PAD + 'px';
  canvas.style.height = maxY + CELL_H + PAD + 'px';
  $('#emptyHint').hidden = list.length > 0 || [...pending.values()].some(p => p.parent === cwd);
  if (cwd === null) $('#emptyHint').hidden = true;
  $('#emptyHint').textContent = filter ? 'No items match your search.' : cwd === TRASH ? 'The Recycle Bin is empty.' : 'This folder is empty. Drop files here.';
}

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('quickdrop.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('quickdrop.' + k, JSON.stringify(v)); } catch {} },
};
const expanded = new Set(store.get('expanded', []));
const saveExpanded = () => store.set('expanded', [...expanded]);

function renderNav() {
  const nav = $('#nav');
  for (const a of pathTo(cwd)) if (a.id !== cwd) expanded.add(a.id);
  const frag = document.createDocumentFragment();
  const sortFolders = list => list.filter(i => i.type === 'folder').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const row = (id, depth, name, icon, hasKids, isOpen) => {
    const r = document.createElement('div');
    r.className = 'nav-row' + (id === cwd ? ' active' : '');
    r.dataset.dropFolder = id ?? '';
    r.style.paddingLeft = 4 + depth * 14 + 'px';
    r.innerHTML = `<span class="tw">${hasKids ? svg(isOpen ? 'chevD' : 'chevR') : ''}</span><span class="ni">${icon}</span><span class="nl">${esc(name)}</span>`;
    r.querySelector('.tw').addEventListener('click', e => {
      e.stopPropagation();
      if (!hasKids || id === null) return;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      saveExpanded(); renderNav();
    });
    r.addEventListener('click', () => go(id));
    r.addEventListener('contextmenu', e => { e.preventDefault(); showNavMenu(id, e.clientX, e.clientY); });
    frag.append(r);
  };
  const walk = (parent, depth) => {
    for (const f of sortFolders(children(parent))) {
      const kids = sortFolders(children(f.id)).length > 0;
      const open = expanded.has(f.id);
      row(f.id, depth, f.name, MINI_FOLDER, kids, open);
      if (kids && open) walk(f.id, depth + 1);
    }
  };
  row(null, 0, APP, DRIVE_ICON, true, true);
  walk(null, 1);
  const sep = document.createElement('div'); sep.className = 'nav-sep'; frag.append(sep);
  const b = document.createElement('div');
  b.className = 'nav-row' + (cwd === TRASH ? ' active' : '');
  b.dataset.dropTrash = '1';
  b.style.paddingLeft = '4px';
  b.innerHTML = `<span class="tw"></span><span class="ni">${BIN_SVG(children(TRASH).length > 0)}</span><span class="nl">${BIN_NAME}</span>`;
  b.addEventListener('click', () => go(TRASH));
  b.addEventListener('contextmenu', e => { e.preventDefault(); showBinMenu(e.clientX, e.clientY); });
  frag.append(b);
  nav.replaceChildren(frag);
}

function renderAddress() {
  const addr = $('#address');
  const parts = cwd === TRASH ? [{ id: TRASH, name: BIN_NAME }] : [{ id: null, name: APP }, ...pathTo(cwd)];
  addr.innerHTML = `<span class="crumb-icon">${cwd === TRASH ? BIN_SVG(true) : cwd ? MINI_FOLDER : DRIVE_ICON}</span>` + parts.map(p =>
    `<span class="chev">${svg('chevR')}</span><button class="crumb" data-drop-folder="${p.id ?? ''}" data-go="${p.id ?? ''}">${esc(p.name)}</button>`).join('');
  addr.scrollLeft = addr.scrollWidth;
  const name = folderName(cwd);
  $('#tabTitle').textContent = name;
  $('#tabIcon').innerHTML = cwd === TRASH ? BIN_SVG(true) : cwd ? MINI_FOLDER : DRIVE_ICON;
  document.title = cwd ? `${name} - ${APP}` : APP;
  $('#search').placeholder = `Search ${name}`;
  $('#btnUp').disabled = !cwd;
}
$('#address').addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b && b.dataset.go !== TRASH) go(b.dataset.go || null);
});

function renderStatus() {
  const list = children(cwd);
  $('#stCount').textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
  const selected = selectedItems();
  const bytes = selected.reduce((s, i) => s + (i.size || 0), 0);
  $('#stSel').textContent = selected.length
    ? `${selected.length} item${selected.length === 1 ? '' : 's'} selected${selected.some(i => i.type === 'file') ? '  ' + fmt(bytes) : ''}`
    : '';
  const ps = [...pending.values()];
  if (ps.length) {
    const tot = ps.reduce((s, p) => s + p.total, 0), done = ps.reduce((s, p) => s + p.loaded, 0);
    $('#stUpload').textContent = `Uploading ${ps.length} item${ps.length === 1 ? '' : 's'}… ${tot ? Math.floor((done / tot) * 100) : 0}%`;
  } else $('#stUpload').textContent = busyText;
  const usedPct = state.quota ? Math.min(100, (state.used / state.quota) * 100) : 0;
  $('#quotaFill').style.width = usedPct + '%';
  $('#quota').classList.toggle('full', usedPct >= 90);
  $('#quotaText').textContent = `${fmt(Math.max(0, state.quota - state.used))} free of ${fmt(state.quota)}`;
}

function renderCommands() {
  const selected = selectedItems();
  const bin = cwd === TRASH;
  for (const id of ['#cmdNew', '#cmdUpload', '#cmdRename', '#cmdDownload', '#cmdArrange', '#sepEdit']) $(id).hidden = bin;
  for (const id of ['#cmdRestore', '#cmdEmpty']) $(id).hidden = !bin;
  $('#cmdRename').disabled = selected.length !== 1;
  $('#cmdDelete').disabled = selected.length === 0;
  $('#cmdDownload').disabled = !selected.some(i => i.type === 'file');
  $('#cmdRestore').querySelector('.cb-label').textContent = selected.length ? 'Restore selected' : 'Restore all';
  $('#cmdRestore').disabled = $('#cmdEmpty').disabled = !children(TRASH).length;
}

function updateSelection() {
  for (const [id, el] of els) el.classList.toggle('sel', sel.has(id));
  renderStatus(); renderCommands();
}
function select(ids) { sel.clear(); ids.forEach(i => sel.add(i)); updateSelection(); }

// ---------------- navigation ----------------
function readHash() {
  if (location.hash === '#/trash') return TRASH;
  const m = location.hash.match(/^#\/f\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function go(id) {
  const h = id === TRASH ? '#/trash' : id ? `#/f/${encodeURIComponent(id)}` : '#/';
  if (location.hash !== h) location.hash = h;
}
window.addEventListener('hashchange', async () => {
  const id = readHash();
  if (id && id !== TRASH && !state.items.has(id)) await load(); // e.g. a folder created moments ago on another device
  cwd = id === TRASH ? TRASH : id && state.items.get(id)?.type === 'folder' && !inTrash(id) ? id : null;
  sel.clear(); filter = ''; $('#search').value = '';
  for (const el of els.values()) el.remove();
  els.clear();
  content.scrollTo(0, 0);
  render();
});
// run fn once folder `id` is the current folder
function goThen(id, fn) {
  if (cwd === id) return fn();
  window.addEventListener('hashchange', () => setTimeout(fn, 50), { once: true });
  go(id);
}
$('#btnBack').onclick = () => history.back();
$('#btnFwd').onclick = () => history.forward();
$('#btnUp').onclick = () => { if (cwd) go(cwd === TRASH ? null : state.items.get(cwd)?.parent ?? null); };
$('#btnRefresh').onclick = () => load();

// ---------------- open / download ----------------
function downloadIds(ids) {
  const files = ids.map(id => state.items.get(id)).filter(i => i?.type === 'file');
  files.forEach((it, n) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = fileUrl(it); a.download = it.name;
    document.body.append(a); a.click(); a.remove();
  }, n * 400));
}
// The action double-click / Enter performs: first module that claims the item, else download
function defaultAction(it) {
  if (it.type === 'folder') return { label: 'Open', icon: 'open', run: () => go(it.id) };
  for (const m of active) {
    const a = m.inst.defaultAction?.(it);
    if (a) return a;
  }
  return { label: 'Download', icon: 'download', run: () => downloadIds([it.id]) };
}
function openItem(id) {
  const it = state.items.get(id);
  if (it && !inTrash(id)) defaultAction(it).run();
}

// ---------------- pointer: select / move / marquee ----------------
let lastTap = { id: null, t: 0 };
let suppressMenuUntil = 0;

content.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  hideMenu();
  if (e.target.closest('.rename')) return;
  const itemEl = e.target.closest('.item');
  if (itemEl?.classList.contains('uploading')) return;
  if (document.activeElement !== content) content.focus({ preventScroll: true });
  if (itemEl) onItemDown(e, itemEl.dataset.id, itemEl);
  else onEmptyDown(e);
});

// Mouse drags use native drag & drop (so files can be dragged out to the desktop);
// touch and pen drags move icons with pointer events.
function onItemDown(e, id, itemEl) {
  const native = e.pointerType === 'mouse';
  itemEl.draggable = native && !renaming && cwd !== TRASH;
  const additive = e.ctrlKey || e.metaKey;
  let toggled = false;
  if (additive) { sel.has(id) ? sel.delete(id) : sel.add(id); toggled = true; }
  else if (e.shiftKey) sel.add(id);
  else if (!sel.has(id)) { sel.clear(); sel.add(id); }
  updateSelection();

  const sx = e.clientX, sy = e.clientY;
  let moved = false, target = null, longPressed = false;
  const group = () => [...sel].filter(i => els.has(i));
  const lp = !native ? setTimeout(() => {
    if (moved) return;
    longPressed = true;
    suppressMenuUntil = Date.now() + 800;
    showItemMenu(sx, sy);
  }, 550) : null;

  const move = ev => {
    if (native) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved) {
      if (Math.hypot(dx, dy) < 5 || longPressed || !sel.has(id) || cwd === TRASH) return;
      moved = true; dragging = true; clearTimeout(lp); hideMenu();
      for (const gid of group()) els.get(gid).classList.add('dragging');
    }
    for (const gid of group()) els.get(gid).style.transform = `translate(${dx}px, ${dy}px)`;
    const t = dropTargetAt(ev.clientX, ev.clientY, new Set(group()));
    if (target?.el !== t?.el) { target?.el?.classList.remove('drop-target'); t?.el?.classList.add('drop-target'); }
    target = t;
    autoScroll(ev);
  };
  const up = async ev => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    clearTimeout(lp); stopAutoScroll();
    if (!moved) {
      if (longPressed || ev.type === 'pointercancel') return;
      if (!additive && !e.shiftKey && !toggled && sel.size > 1) { sel.clear(); sel.add(id); updateSelection(); }
      const now = Date.now();
      if (lastTap.id === id && now - lastTap.t < 450) { lastTap = { id: null, t: 0 }; openItem(id); }
      else lastTap = { id, t: now };
      return;
    }
    const ids = group();
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    target?.el?.classList.remove('drop-target');
    for (const gid of ids) { const el = els.get(gid); el.classList.remove('dragging'); el.style.transform = ''; }
    dragging = false;
    try {
      if (ev.type === 'pointercancel') {}
      else if (target?.trash) await trashIds(ids);
      else if (target && target.folder !== cwd) await moveInto(ids, target.folder);
      else await reposition(ids, dx + (content.scrollLeft - scroll0.x), dy + (content.scrollTop - scroll0.y));
    } catch (err) { await alertDialog(APP, err.message); }
    flushRefresh();
  };
  const scroll0 = { x: content.scrollLeft, y: content.scrollTop };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

let scrollTimer = null, scrollVec = { x: 0, y: 0 };
function autoScroll(ev) {
  const r = content.getBoundingClientRect(), edge = 36;
  scrollVec.x = ev.clientX > r.right - edge ? 12 : ev.clientX < r.left + edge ? -12 : 0;
  scrollVec.y = ev.clientY > r.bottom - edge ? 12 : ev.clientY < r.top + edge ? -12 : 0;
  if ((scrollVec.x || scrollVec.y) && !scrollTimer) {
    scrollTimer = setInterval(() => content.scrollBy(scrollVec.x, scrollVec.y), 30);
  } else if (!scrollVec.x && !scrollVec.y) stopAutoScroll();
}
function stopAutoScroll() { clearInterval(scrollTimer); scrollTimer = null; }

function dropTargetAt(x, y, exclude) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const bin = el.closest('[data-drop-trash]');
  if (bin) return { el: bin, trash: true };
  const f = el.closest('.item.folder');
  if (f && !exclude?.has(f.dataset.id)) return { el: f, folder: f.dataset.id };
  const n = el.closest('[data-drop-folder]');
  if (n) {
    const folder = n.dataset.dropFolder || null;
    if (exclude && [...exclude].some(id => folder === id || pathTo(folder).some(a => a.id === id))) return null;
    return { el: n, folder };
  }
  return null;
}

async function reposition(ids, dx, dy) {
  const moves = ids.map(id => {
    const it = state.items.get(id);
    it.x = Math.max(0, Math.round(it.x + dx)); it.y = Math.max(0, Math.round(it.y + dy));
    return { id, x: it.x, y: it.y };
  });
  renderContent();
  await api('POST', '/api/move', { moves });
}

async function moveInto(ids, folder) {
  if (!ids.length) return;
  const spots = freeSpots(folder, ids.length);
  const moves = ids.map((id, i) => ({ id, parent: folder, ...spots[i] }));
  await api('POST', '/api/move', { moves });
  sel.clear();
  await load();
}

function onEmptyDown(e) {
  if (e.pointerType !== 'mouse') {
    // touch: tap on empty space clears selection; scrolling stays native
    const sx = e.clientX, sy = e.clientY;
    const up = ev => {
      window.removeEventListener('pointerup', up);
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) { sel.clear(); updateSelection(); }
    };
    window.addEventListener('pointerup', up);
    return;
  }
  const additive = e.ctrlKey || e.metaKey || e.shiftKey;
  const base = additive ? new Set(sel) : new Set();
  if (!additive) { sel.clear(); updateSelection(); }
  const start = contentPoint(e);
  let box = null;
  const move = ev => {
    const p = contentPoint(ev);
    if (!box) {
      if (Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      box = document.createElement('div'); box.className = 'marquee'; canvas.append(box);
    }
    const x1 = Math.min(start.x, p.x), y1 = Math.min(start.y, p.y), x2 = Math.max(start.x, p.x), y2 = Math.max(start.y, p.y);
    Object.assign(box.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
    sel.clear(); base.forEach(i => sel.add(i));
    for (const it of children(cwd)) {
      const el = els.get(it.id);
      if (!el || el.classList.contains('hidden')) continue;
      if (it.x < x2 && it.x + ITEM_W > x1 && it.y < y2 && it.y + el.offsetHeight > y1) sel.add(it.id);
    }
    updateSelection();
    autoScroll(ev);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    stopAutoScroll();
    box?.remove();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ---------------- native drag & drop ----------------
// Out: dragging an icon (mouse) onto the desktop / a file manager downloads it there (Chrome/Edge).
// In: files and folders from the OS. Within: moves icons / into folders.
const DRAG_TYPE = 'application/x-quickdrop';
let ndrag = null;
canvas.addEventListener('dragstart', e => {
  const el = e.target.closest?.('.item');
  if (!el || el.classList.contains('uploading') || renaming || cwd === TRASH) { e.preventDefault(); return; }
  const id = el.dataset.id;
  if (!sel.has(id)) select([id]);
  const ids = [...sel].filter(i => els.has(i));
  ndrag = { ids, x: e.clientX, y: e.clientY, sx: content.scrollLeft, sy: content.scrollTop };
  dragging = true;
  hideMenu();
  const dt = e.dataTransfer;
  dt.effectAllowed = 'copyMove';
  dt.setData(DRAG_TYPE, ids.join(','));
  const files = ids.map(i => state.items.get(i)).filter(i => i?.type === 'file');
  if (ids.length === 1 && files.length === 1) {
    const f = files[0];
    dt.setData('DownloadURL', `${f.mime || 'application/octet-stream'}:${f.name}:${location.origin}${fileUrl(f)}`);
  }
  if (ids.length > 1) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ids.slice(0, 4).forEach((gid, i) => {
      const c = els.get(gid).querySelector('.icon').cloneNode(true);
      c.style.cssText = `position:absolute;left:${i * 6}px;top:${i * 6}px`;
      ghost.append(c);
    });
    ghost.insertAdjacentHTML('beforeend', `<span class="drag-count">${ids.length}</span>`);
    document.body.append(ghost);
    dt.setDragImage(ghost, 32, 32);
    setTimeout(() => ghost.remove());
  } else {
    const r = el.getBoundingClientRect();
    dt.setDragImage(el, e.clientX - r.left, e.clientY - r.top);
  }
  setTimeout(() => ids.forEach(i => els.get(i)?.classList.add('drag-src')));
});
canvas.addEventListener('dragend', () => {
  for (const el of els.values()) el.classList.remove('drag-src');
  ndrag = null; dragging = false;
  setHover(null);
  flushRefresh();
});

const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
let hoverEl = null;
function setHover(el) {
  if (hoverEl === el) return;
  if (hoverEl === content) content.classList.remove('drop-hover'); else hoverEl?.classList.remove('drop-target');
  hoverEl = el;
  if (el === content) content.classList.add('drop-hover'); else el?.classList.add('drop-target');
}
function externalTarget(e) {
  const t = dropTargetAt(e.clientX, e.clientY);
  if (t) return t;
  return { el: content, folder: cwd, point: content.contains(e.target) ? contentPoint(e) : null };
}
document.addEventListener('dragover', e => {
  if (ndrag) {
    const t = dropTargetAt(e.clientX, e.clientY, new Set(ndrag.ids));
    if (t || content.contains(e.target)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setHover(t && (t.trash || t.folder !== cwd) ? t.el : null);
    } else setHover(null);
    return;
  }
  if (!hasFiles(e)) return;
  e.preventDefault();
  const t = externalTarget(e);
  const no = t.trash || t.folder === TRASH;
  e.dataTransfer.dropEffect = no ? 'none' : 'copy';
  setHover(no ? null : t.el);
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) setHover(null); });
document.addEventListener('drop', e => {
  if (ndrag) {
    e.preventDefault();
    const d = ndrag;
    const t = dropTargetAt(e.clientX, e.clientY, new Set(d.ids));
    setHover(null);
    const p = t?.trash ? trashIds(d.ids)
      : t && t.folder !== cwd
      ? moveInto(d.ids, t.folder)
      : reposition(d.ids, e.clientX - d.x + content.scrollLeft - d.sx, e.clientY - d.y + content.scrollTop - d.sy);
    p.catch(err => alertDialog(APP, err.message));
    return;
  }
  if (!hasFiles(e)) return;
  e.preventDefault();
  const t = externalTarget(e);
  setHover(null);
  if (t.trash || t.folder === TRASH) return;
  const dtItems = [...e.dataTransfer.items].filter(i => i.kind === 'file');
  const entries = dtItems.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const files = [...e.dataTransfer.files];
  const point = t.folder === cwd && t.el === content ? t.point : null;
  (async () => {
    let tree;
    if (entries.length) tree = await Promise.all(entries.map(readEntry));
    else tree = files.map(f => ({ name: f.name, file: f }));
    ingestTree(tree.filter(Boolean), t.folder, point);
  })().catch(err => alertDialog(APP, 'Could not read the dropped items.\n' + err.message));
});

async function readEntry(entry) {
  if (entry.isFile) return { name: entry.name, file: await new Promise((res, rej) => entry.file(res, rej)) };
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      all.push(...batch);
    }
    return { name: entry.name, children: (await Promise.all(all.map(readEntry))).filter(Boolean) };
  }
  return null;
}
const treeSize = nodes => nodes.reduce((s, n) => s + (n.file ? n.file.size : treeSize(n.children)), 0);
const treeCount = nodes => nodes.reduce((s, n) => s + (n.file ? 1 : treeCount(n.children)), 0);

async function ingestTree(nodes, folder, point) {
  if (!nodes.length) return;
  const total = treeSize(nodes), free = freeBytes();
  if (total > free) {
    const n = treeCount(nodes);
    await alertDialog('Not enough space',
      `There is not enough space on ${APP}.\n\nYou need an additional ${fmt(total - free)} to copy ${n === 1 ? 'this item' : 'these items'}. ` +
      `${fmt(free)} is free of ${fmt(state.quota)}.` +
      (trashBytes() ? `\n\nEmptying the Recycle Bin would free ${fmt(trashBytes())}.` : ''));
    return;
  }
  const spots = point ? blockAt(point, nodes.length) : freeSpots(folder, nodes.length);
  await placeNodes(nodes, folder, spots);
}

async function placeNodes(nodes, folder, spots) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], pos = spots[i];
    if (n.file) queueUpload(n.file, folder, pos);
    else {
      try {
        const f = await api('POST', '/api/folders', { name: n.name, parent: folder, ...pos });
        state.items.set(f.id, f);
        if (folder === cwd) render();
        await placeNodes(n.children, f.id, gridSpots(n.children.length));
      } catch (err) { uploadErrors.push(`${n.name}: ${err.message}`); maybeReportErrors(); }
    }
  }
}

// ---------------- context menus ----------------
content.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (Date.now() < suppressMenuUntil) return;
  const itemEl = e.target.closest('.item');
  if (itemEl?.classList.contains('uploading')) return;
  if (itemEl) {
    const id = itemEl.dataset.id;
    if (!sel.has(id)) select([id]);
    showItemMenu(e.clientX, e.clientY);
  } else if (cwd === TRASH) {
    select([]);
    showMenu(e.clientX, e.clientY, [
      { label: 'Empty Recycle Bin', icon: 'delete', disabled: !children(TRASH).length, action: emptyBin },
      { label: 'Restore all items', icon: 'undo', disabled: !children(TRASH).length, action: () => restoreIds(null) },
      { sep: true },
      { label: 'Refresh', icon: 'refresh', key: 'F5', action: load },
    ]);
  } else {
    select([]);
    const pt = contentPoint(e);
    const pos = { x: Math.max(0, Math.round(pt.x - ITEM_W / 2)), y: Math.max(0, Math.round(pt.y - 36)) };
    showMenu(e.clientX, e.clientY, [
      { label: 'New folder', icon: 'newfolder', key: 'Ctrl+Shift+N', action: () => newFolder(pos) },
      ...moduleEntries('newMenu', { parent: cwd, ...pos }),
      { label: 'Upload files', icon: 'upload', action: () => $('#filePick').click() },
      { sep: true },
      { label: 'Arrange icons', icon: 'arrange', action: arrange },
      { label: 'Refresh', icon: 'refresh', key: 'F5', action: load },
    ]);
  }
});
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

function showItemMenu(x, y) {
  const items = selectedItems();
  if (!items.length) return;
  if (cwd === TRASH) {
    return showMenu(x, y, [
      { label: 'Restore', icon: 'undo', bold: true, action: () => restoreIds(items.map(i => i.id)) },
      { sep: true },
      { label: 'Delete permanently', icon: 'delete', key: 'Del', action: () => deleteSelected(true) },
    ]);
  }
  const single = items.length === 1 ? items[0] : null;
  const def = single ? defaultAction(single) : null;
  const opens = moduleEntries('itemMenu', items);
  const entries = [];
  if (def) entries.push({ label: def.label, icon: def.icon, key: 'Enter', bold: true, action: def.run });
  for (const en of opens.filter(en => (en.group || 'open') === 'open')) if (!def || en.label !== def.label) entries.push(en);
  if (items.some(i => i.type === 'file') && def?.label !== 'Download') {
    entries.push({ label: 'Download', icon: 'download', action: () => downloadIds(items.map(i => i.id)) });
  }
  entries.push({ sep: true }, ...opens.filter(en => en.group === 'send'), { sep: true });
  if (single) entries.push({ label: 'Rename', icon: 'rename', key: 'F2', action: () => startRename(single.id) });
  entries.push({ label: 'Delete', icon: 'delete', key: 'Del', action: deleteSelected });
  showMenu(x, y, entries);
}

function showNavMenu(id, x, y) {
  const entries = [
    { label: 'Open', icon: 'open', bold: true, action: () => go(id) },
    { label: 'New folder', icon: 'newfolder', action: () => goThen(id, () => newFolder()) },
  ];
  const it = id && state.items.get(id);
  if (it) {
    entries.push({ sep: true },
      { label: 'Rename', icon: 'rename', action: () => goThen(it.parent, () => startRename(id)) },
      { label: 'Delete', icon: 'delete', action: () => { select([id]); deleteSelected(); } });
  }
  showMenu(x, y, entries);
}

function showBinMenu(x, y) {
  const n = children(TRASH).length;
  showMenu(x, y, [
    { label: 'Open', icon: 'open', bold: true, action: () => go(TRASH) },
    { label: 'Empty Recycle Bin', icon: 'delete', disabled: !n, action: emptyBin },
    ...(n ? [{ label: 'Restore all items', icon: 'undo', action: () => restoreIds(null) }] : []),
  ]);
}

// entries: { label, icon?, key?, action, bold?, checked?, disabled?, items? (submenu) } | { sep: true }
const submenu = document.createElement('div');
submenu.className = 'menu submenu';
submenu.hidden = true;
document.body.append(submenu);
function fillMenu(el, entries) {
  el.innerHTML = '';
  for (const en of entries) {
    if (en.sep) { if (el.lastChild && !el.lastChild.classList.contains('ms')) el.insertAdjacentHTML('beforeend', '<div class="ms"></div>'); continue; }
    const b = document.createElement('button');
    b.className = 'mi' + (en.bold ? ' bold' : '') + (en.items ? ' has-sub' : '');
    b.disabled = !!en.disabled;
    const icon = en.checked ? svg('check') : en.icon ? svg(en.icon) : '<span class="mi-blank"></span>';
    b.innerHTML = `${icon}<span>${esc(en.label)}</span>${en.key ? `<span class="mk">${esc(en.key)}</span>` : ''}${en.items ? `<span class="mk">${svg('chevR')}</span>` : ''}`;
    if (en.items) {
      const open = () => openSubmenu(b, en.items);
      b.onmouseenter = open;
      b.onclick = open;
    } else {
      if (el === menu) b.onmouseenter = () => { submenu.hidden = true; menu.querySelector('.mi.open')?.classList.remove('open'); };
      b.onclick = () => { hideMenu(); en.action(); };
    }
    el.append(b);
  }
  if (el.lastChild?.classList.contains('ms')) el.lastChild.remove();
}
function openSubmenu(anchor, entries) {
  menu.querySelectorAll('.mi.open').forEach(m => m.classList.remove('open'));
  anchor.classList.add('open');
  fillMenu(submenu, entries);
  submenu.hidden = false;
  const a = anchor.getBoundingClientRect(), r = submenu.getBoundingClientRect();
  const right = a.right + 2 + r.width <= innerWidth - 4;
  submenu.style.left = (right ? a.right + 2 : Math.max(4, a.left - r.width - 2)) + 'px';
  submenu.style.top = Math.max(4, Math.min(a.top - 5, innerHeight - r.height - 4)) + 'px';
}
function showMenu(x, y, entries) {
  submenu.hidden = true;
  fillMenu(menu, entries);
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function hideMenu() { menu.hidden = true; submenu.hidden = true; }
document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !submenu.contains(e.target)) hideMenu(); }, true);
window.addEventListener('blur', hideMenu);
content.addEventListener('scroll', hideMenu);

// ---------------- commands ----------------
async function newFolder(pos) {
  try {
    pos ||= freeSpots(cwd, 1)[0];
    const f = await api('POST', '/api/folders', { name: 'New folder', parent: cwd, ...pos });
    state.items.set(f.id, f);
    sel.clear(); sel.add(f.id);
    render();
    startRename(f.id);
  } catch (err) { alertDialog(APP, err.message); }
}

function startRename(id) {
  const el = els.get(id), it = state.items.get(id);
  if (!el || !it || renaming) return;
  renaming = true;
  el.draggable = false;
  select([id]);
  const label = el.querySelector('.label');
  const ta = document.createElement('textarea');
  ta.className = 'rename'; ta.value = it.name; ta.spellcheck = false; ta.rows = 1;
  label.replaceWith(ta);
  ta.focus();
  const dot = it.type === 'file' ? it.name.lastIndexOf('.') : -1;
  ta.setSelectionRange(0, dot > 0 ? dot : it.name.length);
  let done = false;
  const finish = async commit => {
    if (done) return; done = true;
    const v = ta.value.replace(/\s+/g, ' ').trim();
    ta.replaceWith(label);
    renaming = false;
    el.draggable = true;
    content.focus({ preventScroll: true });
    if (commit && v && v !== it.name) {
      label.textContent = v;
      try { await api('PATCH', `/api/items/${encodeURIComponent(id)}`, { name: v }); }
      catch (err) { label.textContent = it.name; await alertDialog('Rename', err.message); }
    }
    refresh();
  };
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  ta.addEventListener('blur', () => finish(true));
  ta.addEventListener('pointerdown', e => e.stopPropagation());
}

// Delete moves to the Recycle Bin (undo with Ctrl+Z); permanent with Shift+Del or inside the bin.
let lastTrashed = [];
async function trashIds(ids) {
  ids = ids.filter(i => state.items.has(i));
  if (!ids.length) return;
  await api('POST', '/api/delete', { ids });
  lastTrashed = ids;
  sel.clear();
  await load();
}
async function deleteSelected(permanent) {
  const items = selectedItems();
  if (!items.length) return;
  if (!permanent && cwd !== TRASH) return trashIds(items.map(i => i.id)).catch(err => alertDialog('Delete', err.message));
  const one = items.length === 1 ? items[0] : null;
  const title = one ? (one.type === 'folder' ? 'Delete Folder' : 'Delete File') : 'Delete Multiple Items';
  const msg = one
    ? `Are you sure you want to permanently delete ${one.type === 'folder' ? 'this folder and everything in it' : 'this file'}?\n\n${one.name}`
    : `Are you sure you want to permanently delete these ${items.length} items?`;
  if (!(await confirmDialog(title, msg))) return;
  try {
    await api('POST', '/api/delete', { ids: items.map(i => i.id), permanent: true });
    sel.clear();
    await load();
  } catch (err) { alertDialog('Delete', err.message); }
}
async function restoreIds(ids) {
  try {
    await api('POST', '/api/restore', ids ? { ids } : {});
    sel.clear();
    await load();
  } catch (err) { alertDialog(BIN_NAME, err.message); }
}
async function emptyBin() {
  const list = children(TRASH);
  if (!list.length) return;
  const msg = list.length === 1 ? `Are you sure you want to permanently delete "${list[0].name}"?`
    : `Are you sure you want to permanently delete these ${list.length} items?`;
  if (!(await confirmDialog('Empty Recycle Bin', msg))) return;
  try { await api('POST', '/api/trash/empty', {}); sel.clear(); await load(); }
  catch (err) { alertDialog(BIN_NAME, err.message); }
}
async function undoDelete() {
  const ids = lastTrashed.filter(id => state.items.get(id)?.parent === TRASH);
  lastTrashed = [];
  if (ids.length) { await restoreIds(ids); select(ids); }
}

async function arrange() {
  const list = children(cwd).sort((a, b) =>
    (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const spots = gridSpots(list.length);
  const moves = list.map((it, i) => { Object.assign(it, spots[i]); return { id: it.id, ...spots[i] }; });
  renderContent();
  try { await api('POST', '/api/move', { moves }); } catch (err) { alertDialog(APP, err.message); }
}

$('#cmdNew').onclick = () => cwd !== TRASH && newFolder();
$('#cmdUpload').onclick = () => $('#filePick').click();
$('#cmdRename').onclick = () => { if (sel.size === 1) startRename([...sel][0]); };
$('#cmdDownload').onclick = () => downloadIds([...sel]);
$('#cmdArrange').onclick = arrange;
$('#cmdSettings').onclick = () => openSettings();
$('#cmdHelp').onclick = () => openHelp();
$('#cmdRestore').onclick = () => restoreIds(sel.size ? [...sel] : null);
$('#cmdEmpty').onclick = emptyBin;
$('#cmdDelete').onclick = () => deleteSelected();
$('#filePick').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) ingestTree(files.map(f => ({ name: f.name, file: f })), cwd, null);
});

const searchEl = $('#search');
searchEl.addEventListener('input', () => { filter = searchEl.value.trim().toLowerCase(); renderContent(); });
document.querySelector('.search').addEventListener('click', e => {
  const s = e.currentTarget;
  if (!s.classList.contains('open')) { s.classList.add('open'); searchEl.focus(); }
});
searchEl.addEventListener('blur', () => { if (!searchEl.value) document.querySelector('.search').classList.remove('open'); });

// ---------------- keyboard ----------------
document.addEventListener('keydown', e => {
  if (!modal.hidden) return;
  for (const m of active) if (m.inst.onKey?.(e)) return;
  if (e.target.closest?.('.appwin')) return;
  const inField = e.target.closest?.('input, textarea');
  const k = e.key;
  if (k === 'Escape') { hideMenu(); if (!inField) select([]); return; }
  if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); history.back(); return; }
  if (e.altKey && k === 'ArrowRight') { e.preventDefault(); history.forward(); return; }
  if (e.altKey && k === 'ArrowUp') { e.preventDefault(); $('#btnUp').click(); return; }
  if (k === 'F5') { e.preventDefault(); load(); return; }
  if (k === 'F1') { e.preventDefault(); openHelp(); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && k.toLowerCase() === 'n') { e.preventDefault(); if (cwd !== TRASH) newFolder(); return; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f') { e.preventDefault(); document.querySelector('.search').classList.add('open'); searchEl.focus(); return; }
  if (inField) return;
  if (k === 'Delete') { e.preventDefault(); deleteSelected(e.shiftKey); }
  else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoDelete(); }
  else if (k === 'F2') { e.preventDefault(); if (sel.size === 1 && cwd !== TRASH) startRename([...sel][0]); }
  else if (k === 'Enter') {
    e.preventDefault();
    if (cwd === TRASH) return;
    const items = selectedItems();
    if (items.length === 1) openItem(items[0].id); else downloadIds(items.map(i => i.id));
  }
  else if (k === 'Backspace') { e.preventDefault(); $('#btnUp').click(); }
  else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') {
    e.preventDefault();
    children(cwd).forEach(i => { if (!els.get(i.id)?.classList.contains('hidden')) sel.add(i.id); });
    updateSelection();
  }
});

// ---------------- dialogs ----------------
const WARN_ICON = '<svg viewBox="0 0 32 32"><path d="M16 3 30 28H2z" fill="#F7C948" stroke="#C99A06" stroke-linejoin="round"/><path d="M16 12v8" stroke="#3b2f00" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="24" r="1.5" fill="#3b2f00"/></svg>';
const INFO_ICON = '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#0067c0"/><path d="M16 14v9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="9.5" r="1.7" fill="#fff"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 32 32"><rect x="6" y="14" width="20" height="15" rx="2.5" fill="#E8A720"/><path d="M10.5 14v-3.5a5.5 5.5 0 0 1 11 0V14" fill="none" stroke="#8a8f96" stroke-width="2.6"/><circle cx="16" cy="21" r="2.2" fill="#6b4a00"/></svg>';
function dialog(title, message, buttons, icon) {
  return new Promise(resolve => {
    hideMenu();
    const prev = document.activeElement;
    modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-title">${esc(title)}</div>
      <div class="dialog-body">${icon}<p>${esc(message)}</p></div>
      <div class="dialog-buttons"></div></div>`;
    const bar = modal.querySelector('.dialog-buttons');
    const close = v => {
      modal.hidden = true; modal.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      (prev && prev !== document.body ? prev : content).focus?.({ preventScroll: true });
      resolve(v);
    };
    buttons.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'btn' + (i === 0 ? ' primary' : '');
      el.textContent = b.label;
      el.onclick = () => close(b.value);
      bar.append(el);
    });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(buttons[buttons.length - 1].value); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(buttons[0].value); }
    };
    document.addEventListener('keydown', onKey, true);
    modal.hidden = false;
    bar.firstChild.focus();
  });
}
const confirmDialog = (t, m) => dialog(t, m, [{ label: 'Yes', value: true }, { label: 'No', value: false }], WARN_ICON);
const alertDialog = (t, m) => dialog(t, m, [{ label: 'OK', value: true }], INFO_ICON);

// Form dialog. submit(form) returns a value to close with, or { error } to show inline.
function formDialog({ title, html, ok = 'OK', cancel = 'Cancel', icon = '', submit, init, wide, cls = '' }) {
  const noCancel = cancel === null;
  return new Promise(resolve => {
    hideMenu();
    const prev = document.activeElement;
    modal.innerHTML = `<form class="dialog${wide ? ' wide' : ''}${noCancel ? ' no-cancel' : ''} ${cls}" role="dialog" aria-modal="true" novalidate>
      <div class="dialog-title">${esc(title)}</div>
      <div class="dialog-body">${icon}<div class="dialog-form">${html}<div class="dlg-error" hidden></div></div></div>
      <div class="dialog-buttons"><button type="submit" class="btn primary">${esc(ok)}</button><button type="button" class="btn dlg-cancel">${esc(cancel || '')}</button></div>
    </form>`;
    const form = modal.querySelector('form'), err = form.querySelector('.dlg-error'), okBtn = form.querySelector('[type=submit]');
    const close = v => {
      modal.hidden = true; modal.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      (prev && prev !== document.body ? prev : content).focus?.({ preventScroll: true });
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    form.querySelector('.dlg-cancel').onclick = () => close(null);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      okBtn.disabled = true; err.hidden = true;
      try {
        const r = submit ? await submit(form) : true;
        if (r && typeof r === 'object' && 'error' in r) { err.textContent = r.error; err.hidden = false; }
        else close(r ?? true);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      finally { okBtn.disabled = false; }
    });
    init?.(form);
    modal.hidden = false;
    (form.querySelector('[autofocus], input:not([type=checkbox]), select') || okBtn).focus();
  });
}

// ---------------- help ----------------
const HELP_ICONS = {
  laptop: '<svg viewBox="0 0 40 40"><rect x="7" y="9" width="26" height="17" rx="2" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.6"/><path d="M3 30h34l-2.5 3h-29z" fill="#93c5fd" stroke="#3b82f6" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  phone: '<svg viewBox="0 0 40 40"><rect x="12" y="5" width="16" height="30" rx="3" fill="#dcfce7" stroke="#16a34a" stroke-width="1.6"/><path d="M18 31h4" stroke="#16a34a" stroke-width="1.6" stroke-linecap="round"/></svg>',
  arrows: '<svg viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h28m-5-5 5 5-5 5M34 16H6m5-5-5 5 5 5"/></svg>',
};
function openHelp() {
  const on = id => active.some(m => m.id === id);
  const k = (...keys) => keys.map(x => `<kbd>${esc(x)}</kbd>`).join('<span class="kplus">+</span>');
  const card = (icon, title, body, tone) => `<div class="help-card"><span class="help-ic ${tone}">${icon}</span><div><b>${title}</b><p>${body}</p></div></div>`;
  const dbl = [
    on('preview') && 'opens a preview',
    on('notepad') && 'opens text files in Notepad',
    on('zip') && 'unpacks a .zip',
  ].filter(Boolean);
  const mods = state.modules.map(m => `
    <div class="help-mod${m.enabled ? '' : ' off'}">
      <span class="help-mod-ic">${svg(m.icon)}</span>
      <span class="help-mod-text"><b>${esc(m.name)}</b><span>${esc(m.description || '')}</span></span>
      <span class="chip ${m.enabled ? 'on' : ''}">${m.enabled ? 'On' : 'Off'}</span>
    </div>`).join('');
  const rows = [
    ['Open or preview', k('Enter')], on('preview') && ['Quick preview', k('Space')],
    ['Rename', k('F2')], ['Delete to Recycle Bin', k('Del')],
    ['Undo delete', k('Ctrl', 'Z')], ['Delete permanently', k('Shift', 'Del')],
    ['New folder', k('Ctrl', 'Shift', 'N')], ['Select all', k('Ctrl', 'A')],
    ['Search this folder', k('Ctrl', 'F')], ['Back / Forward', k('Alt', '←') + ' ' + k('Alt', '→')],
    ['Up one folder', k('Backspace')], ['Refresh', k('F5')], ['This help', k('F1')],
  ].filter(Boolean);
  return formDialog({
    title: `${APP} help`, ok: 'Close', cancel: null, cls: 'help-dialog',
    html: `<div class="help">
      <div class="help-hero">
        <div class="help-flow">${HELP_ICONS.laptop}<span class="help-arrow">${HELP_ICONS.arrows}</span><span class="help-drive">${DRIVE_ICON}</span><span class="help-arrow">${HELP_ICONS.arrows}</span>${HELP_ICONS.phone}</div>
        <h2>${APP} is a shared drop zone for your home network</h2>
        <p>Put a file in from one device and pick it up on another, whether that's a Windows PC, a Mac, Linux or a phone. It works like an Explorer window you all share: no cables, no cloud accounts, no emailing files to yourself.</p>
      </div>
      <div class="help-grid">
        ${card(svg('upload'), 'Put files in', 'Drag files or whole folders onto the window. They land where you drop them. On a phone, tap <b>Upload</b>.', 'blue')}
        ${card(svg('download'), 'Take files out', `Double-click a file: ${dbl.length ? dbl.join(', ') + '; anything else downloads' : 'it downloads'}. Right-click &gt; <b>Download</b>, or drag it onto your desktop (Chrome, Edge).`, 'green')}
        ${card(svg('arrange'), 'Keep it tidy', 'Icons stay where you put them. Make folders, drag icons into them, box-select with the mouse. <b>Arrange</b> lines everything up.', 'amber')}
        ${card(BIN_SVG(false), 'Recycle Bin', 'Deleted items go to the bin, so mistakes can be undone. Restore them, or empty the bin for good.', 'gray')}
        ${card(svg('refresh'), 'Live on every device', 'Anything you do shows up straight away on every other device that has ' + APP + ' open.', 'violet')}
        ${card(svg('drive'), 'Private and limited', `Files stay on your own server, reachable only from your network. There's room for ${fmt(state.quota)}; the bar at the bottom right shows what's left.`, 'teal')}
      </div>
      <div class="help-section">
        <div class="help-section-head">
          <span class="help-ic blue">${svg('settings')}</span>
          <div><b>Settings: choose your tools</b><p>On its own, ${APP} only stores and shares files. Modules add tools for opening and editing them. Switch each one on or off in <b>Settings</b>; the choice applies to every device.</p></div>
        </div>
        <div class="help-mods">${mods || '<p>No modules installed.</p>'}</div>
        <button type="button" class="btn help-open-settings">${svg('settings')}Open Settings</button>
      </div>
      <div class="help-section">
        <div class="help-section-head"><span class="help-ic gray">${svg('help')}</span><div><b>Keyboard shortcuts</b><p>Right-click anything for the same actions.</p></div></div>
        <div class="help-keys">${rows.map(([a, b]) => `<div class="help-key"><span>${a}</span><span>${b}</span></div>`).join('')}</div>
      </div>
    </div>`,
    init: f => {
      f.querySelector('.help-open-settings').onclick = () => { f.querySelector('.dlg-cancel').click(); setTimeout(openSettings); };
    },
  });
}

// ---------------- settings ----------------
function openSettings() {
  const rows = state.modules.map(m => `
    <label class="mod-row">
      <span class="mod-icon">${svg(m.icon)}</span>
      <span class="mod-text"><span class="mod-name">${esc(m.name)}</span><span class="mod-desc">${esc(m.description || '')}</span></span>
      <input type="checkbox" class="switch" name="${esc(m.id)}" ${m.enabled ? 'checked' : ''}>
    </label>`).join('');
  return formDialog({
    title: `${APP} settings`, ok: 'Save', wide: true,
    html: `<div class="settings">
      <div class="set-h">Modules</div>
      <p class="set-note">${APP} on its own is a shared Explorer window. Modules add what happens when you open files.</p>
      ${rows || '<p class="set-note">No modules installed.</p>'}
      <div class="set-h">Storage</div>
      <p class="set-note">${fmt(state.used)} used of ${fmt(state.quota)}.</p></div>`,
    submit: async form => {
      const modules = {};
      form.querySelectorAll('input.switch').forEach(i => { modules[i.name] = i.checked; });
      await api('PUT', '/api/settings', { modules });
      await load();
      return true;
    },
  });
}

// ---------------- upload queue ----------------
let seq = 0, activeUploads = 0;
const queue = [];
const uploadErrors = [];
function queueUpload(file, parent, pos) {
  const tid = ++seq;
  const ext = extOf(file.name);
  const preview = IMG_EXT.has(ext) && file.size < 30e6 ? URL.createObjectURL(file) : null;
  pending.set(tid, { tid, name: file.name, parent, x: pos.x, y: pos.y, loaded: 0, total: file.size, file, preview });
  queue.push(tid);
  renderContent(); renderStatus();
  pump();
}
function pump() {
  while (activeUploads < 3 && queue.length) {
    const p = pending.get(queue.shift());
    if (!p) continue;
    activeUploads++;
    upload(p).finally(() => { activeUploads--; pump(); maybeReportErrors(); });
  }
}
function upload(p) {
  return new Promise(resolve => {
    const q = new URLSearchParams({ name: p.name, x: p.x, y: p.y, mtime: p.file.lastModified || Date.now() });
    if (p.parent) q.set('parent', p.parent);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/upload?' + q);
    xhr.setRequestHeader('Content-Type', p.file.type || 'application/octet-stream');
    let last = 0;
    xhr.upload.onprogress = e => {
      p.loaded = e.loaded;
      const now = performance.now();
      if (now - last > 100) { last = now; renderContent(); renderStatus(); }
    };
    const finish = err => {
      pending.delete(p.tid);
      if (p.preview) setTimeout(() => URL.revokeObjectURL(p.preview), 5000);
      if (err) uploadErrors.push(`${p.name}: ${err}`);
      renderContent(); renderStatus();
      resolve();
    };
    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        state.items.set(d.id, d);
        state.used += d.size;
        if (d.parent === cwd) render(); else { renderNav(); renderStatus(); }
        finish();
      } else finish(d.error || `failed (${xhr.status})`);
    };
    xhr.onerror = () => finish('network error');
    xhr.send(p.file);
  });
}
let reporting = false;
async function maybeReportErrors() {
  if (reporting || activeUploads || queue.length || !uploadErrors.length) return;
  reporting = true;
  const list = uploadErrors.splice(0);
  await alertDialog('Upload problem', (list.length === 1 ? '' : `${list.length} items could not be uploaded:\n\n`) + list.slice(0, 8).join('\n') + (list.length > 8 ? `\n…and ${list.length - 8} more` : ''));
  reporting = false;
  load();
}
window.addEventListener('beforeunload', e => {
  if (pending.size || [...document.querySelectorAll('.appwin')].some(w => w._dirty?.())) { e.preventDefault(); e.returnValue = ''; }
});

// Create a file from a Blob (used by modules)
async function createFile({ name, parent = cwd, blob, x, y, mtime }) {
  if (x === undefined) ({ x, y } = freeSpots(parent, 1)[0]);
  const q = new URLSearchParams({ name, x, y, mtime: mtime || Date.now() });
  if (parent) q.set('parent', parent);
  const r = await fetch('/api/upload?' + q, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Could not create "${name}"`);
  state.items.set(d.id, d); state.used += d.size;
  render();
  return d;
}
// Replace a file's content (used by editors)
async function saveFile(item, blob) {
  const r = await fetch(`/api/files/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'Content-Type': blob.type || item.mime }, body: blob });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Could not save "${item.name}"`);
  state.used += d.size - (state.items.get(d.id)?.size || 0);
  state.items.set(d.id, d);
  render();
  return d;
}

// ---------------- app windows (used by modules) ----------------
const dock = document.createElement('div');
dock.className = 'dock';
document.body.append(dock);
let zTop = 60, winSeq = 0;
function openWindow({ title, icon = '', width = 760, height = 520, onClose }) {
  const w = document.createElement('div');
  w.className = 'appwin';
  w.tabIndex = -1;
  w.innerHTML = `
    <div class="aw-title"><span class="aw-icon">${icon}</span><span class="aw-text"></span><span class="spacer"></span>
      <div class="winbtns">
        <button class="wb aw-min" tabindex="-1" aria-label="Minimize">${svg('min')}</button>
        <button class="wb aw-max" tabindex="-1" aria-label="Maximize">${svg('max')}</button>
        <button class="wb close aw-close" tabindex="-1" aria-label="Close">${svg('close')}</button>
      </div></div>
    <div class="aw-menubar" hidden></div>
    <div class="aw-body"></div>
    <div class="aw-status" hidden></div>`;
  const n = winSeq++ % 8;
  const W = Math.min(width, innerWidth - 32), H = Math.min(height, innerHeight - 32);
  Object.assign(w.style, {
    width: W + 'px', height: H + 'px',
    left: Math.max(8, (innerWidth - W) / 2 + (n - 3) * 26) + 'px',
    top: Math.max(8, (innerHeight - H) / 2 + (n - 3) * 26) + 'px',
  });
  document.body.append(w);
  const chip = document.createElement('button');
  chip.className = 'dock-chip';
  const textEl = w.querySelector('.aw-text');
  const aw = {
    el: w,
    body: w.querySelector('.aw-body'),
    setTitle(t) { textEl.textContent = t; chip.innerHTML = `${icon}<span>${esc(t)}</span>`; chip.title = t; },
    menubar(menus) {
      const bar = w.querySelector('.aw-menubar');
      bar.hidden = false;
      bar.replaceChildren(...menus.map(m => {
        const b = document.createElement('button');
        b.className = 'aw-menu'; b.textContent = m.label;
        b.onclick = () => { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, typeof m.items === 'function' ? m.items() : m.items); };
        return b;
      }));
    },
    status() { const s = w.querySelector('.aw-status'); s.hidden = false; return s; },
    focus() {
      w.style.zIndex = ++zTop;
      document.querySelectorAll('.appwin.active').forEach(x => x.classList.remove('active'));
      w.classList.add('active');
    },
    async close(force) {
      if (!force && onClose && (await onClose()) === false) return false;
      w.remove(); chip.remove();
      return true;
    },
    minimize() { w.hidden = true; dock.append(chip); },
    restore() { w.hidden = false; chip.remove(); aw.focus(); },
  };
  chip.onclick = () => aw.restore();
  w.querySelector('.aw-close').onclick = () => aw.close();
  w.querySelector('.aw-min').onclick = () => aw.minimize();
  const toggleMaxW = () => { w.classList.toggle('max'); w.querySelector('.aw-max').innerHTML = svg(w.classList.contains('max') ? 'restore' : 'max'); };
  w.querySelector('.aw-max').onclick = toggleMaxW;
  const tb = w.querySelector('.aw-title');
  tb.addEventListener('dblclick', e => { if (!e.target.closest('.winbtns')) toggleMaxW(); });
  tb.addEventListener('pointerdown', e => {
    if (e.button !== 0 || w.classList.contains('max') || e.target.closest('.winbtns')) return;
    const r = w.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = ev => {
      w.style.left = Math.max(-r.width + 120, Math.min(innerWidth - 120, ev.clientX - ox)) + 'px';
      w.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  w.addEventListener('pointerdown', () => aw.focus(), true);
  aw.setTitle(title);
  aw.focus();
  return aw;
}

// ---------------- main window chrome ----------------
const prefs = store.get('window', {});
const savePrefs = () => store.set('window', prefs);
function applyWindow() {
  win.classList.toggle('max', !!prefs.max);
  $('#wbMax').innerHTML = svg(prefs.max ? 'restore' : 'max');
  if (prefs.rect && !prefs.max) {
    const { l, t, w, h } = prefs.rect;
    win.classList.add('placed');
    Object.assign(win.style, {
      left: Math.max(0, Math.min(l, innerWidth - 120)) + 'px', top: Math.max(0, Math.min(t, innerHeight - 60)) + 'px',
      width: Math.min(w, innerWidth) + 'px', height: Math.min(h, innerHeight) + 'px',
    });
  }
}
function toggleMax() { prefs.max = !prefs.max; savePrefs(); applyWindow(); }
$('#wbMax').onclick = toggleMax;
$('#titlebar').addEventListener('dblclick', e => { if (!e.target.closest('.winbtns')) toggleMax(); });
$('#titlebar').addEventListener('pointerdown', e => {
  if (e.button !== 0 || prefs.max || e.target.closest('.winbtns, .tab-x, .tab-plus')) return;
  const r = win.getBoundingClientRect();
  const ox = e.clientX - r.left, oy = e.clientY - r.top;
  win.classList.add('placed');
  Object.assign(win.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const move = ev => {
    win.style.left = Math.max(-r.width + 120, Math.min(innerWidth - 120, ev.clientX - ox)) + 'px';
    win.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + 'px';
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); remember(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
function remember() {
  if (prefs.max || !win.classList.contains('placed')) return;
  const r = win.getBoundingClientRect();
  prefs.rect = { l: r.left, t: r.top, w: r.width, h: r.height }; savePrefs();
}
new ResizeObserver(() => { if (win.classList.contains('placed')) remember(); }).observe(win);
applyWindow();

// ---------------- host API for modules ----------------
const host = {
  APP, state, sel, CELL_W, CELL_H,
  get cwd() { return cwd; },
  get selected() { return selectedItems(); },
  api, load, render, select, go, fmt, esc, extOf, svg, fileSvg, fileUrl, isText,
  IMG_EXT, VID_EXT, AUD_EXT, TEXT_EXT,
  icons: P,
  children, pathTo, freeSpots, spotNear, gridCols,
  visibleChildren: () => (cwd === TRASH ? [] : children(cwd)).filter(i => !els.get(i.id)?.classList.contains('hidden')),
  download: downloadIds, startRename,
  alert: alertDialog, confirm: confirmDialog, dialog, form: formDialog, icons32: { WARN_ICON, INFO_ICON, LOCK_ICON },
  showMenu, hideMenu, openWindow, createFile, saveFile, loadPdfjs,
  setBusy(text) { busyText = text || ''; renderStatus(); },
  module: id => active.find(m => m.id === id)?.inst.api,
  focusExplorer: () => content.focus({ preventScroll: true }),
};

// ---------------- boot ----------------
(async () => {
  await load();
  const id = readHash();
  if (id && state.items.get(id)?.type === 'folder') { cwd = id; render(); }
  else if (location.hash !== '#/') history.replaceState(null, '', '#/');
  content.focus({ preventScroll: true });
})();
