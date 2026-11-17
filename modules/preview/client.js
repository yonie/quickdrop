// Preview module: double-click a file to view it (photos, video, audio, PDF, text, file info)
export default function preview(host) {
  const { svg, esc, fmt, extOf, fileUrl, fileSvg, IMG_EXT, VID_EXT, AUD_EXT, CELL_H } = host;
  const NOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';

  const kindOf = it => {
    const e = extOf(it.name);
    if (IMG_EXT.has(e)) return 'image';
    if (VID_EXT.has(e)) return 'video';
    if (AUD_EXT.has(e)) return 'audio';
    if (e === 'pdf') return 'pdf';
    if (host.isText(it)) return 'text';
    return 'info';
  };

  const viewer = document.createElement('div');
  viewer.className = 'viewer';
  viewer.hidden = true;
  viewer.innerHTML = `
    <div class="pv-bar">
      <span class="pv-title"></span><span class="pv-meta"></span><span class="spacer"></span>
      <button class="pv-btn pv-edit" title="Edit" hidden>${svg('edit')}<span class="lbl">Edit</span></button>
      <button class="pv-btn pv-dl" title="Download">${svg('download')}<span class="lbl">Download</span></button>
      <button class="pv-btn icon pv-close" title="Close (Esc)">${svg('close')}</button>
    </div>
    <div class="pv-stage"></div>
    <button class="pv-nav prev" title="Previous (Left Arrow)">${svg('back')}</button>
    <button class="pv-nav next" title="Next (Right Arrow)">${svg('forward')}</button>`;
  document.body.append(viewer);
  const stage = viewer.querySelector('.pv-stage');
  let pv = null, token = 0;

  const editorFor = it => ['paint', 'notepad'].map(id => host.module(id)).find(m => m?.canEdit(it));

  function order() {
    return host.visibleChildren()
      .filter(i => i.type === 'file')
      .sort((a, b) => Math.round(a.y / CELL_H) - Math.round(b.y / CELL_H) || a.x - b.x)
      .map(i => i.id);
  }
  function open(id) {
    const list = order();
    const index = list.indexOf(id);
    if (index < 0) return;
    host.hideMenu();
    pv = { list, index };
    viewer.hidden = false;
    show();
  }
  function show() {
    const id = pv.list[pv.index], it = host.state.items.get(id);
    if (!it) return close();
    host.select([id]);
    viewer.querySelector('.pv-title').textContent = it.name;
    viewer.querySelector('.pv-meta').textContent = `${pv.index + 1} of ${pv.list.length}  ·  ${fmt(it.size)}`;
    viewer.querySelector('.prev').hidden = pv.index === 0;
    viewer.querySelector('.next').hidden = pv.index === pv.list.length - 1;
    viewer.querySelector('.pv-edit').hidden = !editorFor(it);
    const src = fileUrl(it, true);
    const t = ++token;
    const info = note => {
      const ext = extOf(it.name);
      stage.innerHTML = `<div class="pv-info">${fileSvg(it.name).replace('<svg', '<svg width="112" height="112"')}
        <div class="pv-info-name"></div>
        <div class="pv-info-meta">${esc(ext ? ext.toUpperCase() + ' file' : 'File')}  ·  ${fmt(it.size)}  ·  ${esc(new Date(it.mtime).toLocaleString())}</div>
        ${note ? `<div class="pv-info-note">${esc(note)}</div>` : ''}
        <button class="btn primary">Download</button></div>`;
      stage.querySelector('.pv-info-name').textContent = it.name;
      stage.querySelector('button').onclick = () => host.download([id]);
    };
    const fail = () => { if (t === token) info("This file can't be previewed in your browser."); };
    const kind = kindOf(it);
    if (kind === 'image') {
      const el = new Image(); el.alt = it.name; el.draggable = false; el.onerror = fail; el.src = src;
      stage.replaceChildren(el);
    } else if (kind === 'video') {
      const el = document.createElement('video'); el.controls = true; el.autoplay = true; el.playsInline = true; el.onerror = fail; el.src = src;
      stage.replaceChildren(el);
    } else if (kind === 'audio') {
      stage.innerHTML = `<div class="pv-audio"><div class="note">${NOTE_ICON}</div><audio controls autoplay></audio></div>`;
      const a = stage.querySelector('audio'); a.onerror = fail; a.src = src;
    } else if (kind === 'text') {
      if (it.size > 2 * 1024 * 1024) return info('This file is too large to preview.');
      stage.innerHTML = '<div class="pv-loading">Loading…</div>';
      fetch(src).then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(txt => {
        if (t !== token) return;
        const pre = document.createElement('pre'); pre.className = 'pv-text'; pre.textContent = txt;
        stage.replaceChildren(pre);
      }).catch(fail);
    } else if (kind === 'pdf') {
      stage.innerHTML = '<div class="pv-pdf"><div class="pv-loading">Loading…</div></div>';
      renderPdf(src, stage.firstChild, t).catch(fail);
    } else info();
  }
  async function renderPdf(src, box, t) {
    const pdfjs = await host.loadPdfjs();
    const task = pdfjs.getDocument({ url: src, isEvalSupported: false });
    try {
      const doc = await task.promise;
      if (t !== token) return;
      box.replaceChildren();
      const dpr = window.devicePixelRatio || 1;
      for (let n = 1; n <= Math.min(doc.numPages, 200); n++) {
        if (t !== token) return;
        const page = await doc.getPage(n);
        const v1 = page.getViewport({ scale: 1 });
        const cssW = Math.min(900, box.clientWidth - 8);
        const viewport = page.getViewport({ scale: (cssW / v1.width) * dpr });
        const c = document.createElement('canvas');
        c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
        c.style.width = cssW + 'px';
        box.append(c);
        await page.render({ canvas: c, viewport }).promise;
      }
    } finally { if (t !== token) task.destroy(); }
  }
  function step(d) {
    if (!pv) return;
    const n = pv.index + d;
    if (n < 0 || n >= pv.list.length) return;
    pv.index = n; show();
  }
  function close() {
    if (!pv) return;
    pv = null; token++;
    stage.replaceChildren(); // stops playback
    viewer.hidden = true;
    host.focusExplorer();
  }
  viewer.querySelector('.pv-close').onclick = close;
  viewer.querySelector('.pv-dl').onclick = () => pv && host.download([pv.list[pv.index]]);
  viewer.querySelector('.pv-edit').onclick = () => {
    const it = pv && host.state.items.get(pv.list[pv.index]);
    const ed = it && editorFor(it);
    if (ed) { close(); ed.edit(it); }
  };
  viewer.querySelector('.prev').onclick = () => step(-1);
  viewer.querySelector('.next').onclick = () => step(1);
  stage.addEventListener('click', e => { if (e.target === stage) close(); });
  let swipe = null;
  stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && !e.target.closest('video, audio')) swipe = { x: e.clientX, y: e.clientY }; });
  stage.addEventListener('pointerup', e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    else if (dy > 100 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
  });
  stage.addEventListener('pointercancel', () => { swipe = null; });

  return {
    defaultAction: it => it.type === 'file' ? { label: 'Preview', icon: 'eye', run: () => open(it.id) } : null,
    itemMenu: items => items.length === 1 && items[0].type === 'file'
      ? [{ label: 'Preview', icon: 'eye', key: 'Space', action: () => open(items[0].id) }] : [],
    onKey(e) {
      if (pv) {
        if (e.key === 'Escape' || (e.key === ' ' && !e.target.closest('video, audio'))) { e.preventDefault(); close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        return true;
      }
      if (e.key === ' ' && !e.target.closest?.('input, textarea, .appwin')) {
        const s = host.selected;
        if (s.length === 1 && s[0].type === 'file') { e.preventDefault(); open(s[0].id); return true; }
      }
      return false;
    },
    onState() { if (pv && !host.state.items.has(pv.list[pv.index])) close(); },
    disable() { close(); },
    api: { open },
  };
}
