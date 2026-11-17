// Paint module: draw on and edit images
export default function paint(host) {
  const { esc, svg, extOf } = host;
  const ICON = `<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" fill="#fff" stroke="#8a6cd8"/><circle cx="7" cy="8" r="1.6" fill="#f2b636"/><path d="M3 15l4.5-4.5 3 3 2-2 4.5 4.5" fill="none" stroke="#3aa76d" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const EDITABLE = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']);
  const ENCODE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  const canEdit = it => it?.type === 'file' && EDITABLE.has(extOf(it.name)) && it.size <= 40 * 1024 * 1024;
  const PALETTE = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
                   '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
  const T = {
    pencil: 'M13.5 3.5l3 3L7 16H4v-3zM11.5 5.5l3 3',
    brush: 'M16 3.5c-1.5 0-6 4.5-7.5 6.5L10 11.5c2-1.5 6.5-6 6.5-7.5a.5.5 0 0 0-.5-.5zM8 10.5c-2 0-3 1.5-3 3 0 1-1 2-2 2 1.5 1.5 6 1.5 6.5-2.5',
    eraser: 'M8 16.5h8.5M3.5 12l7-7.5 5.5 5.5-6.5 6.5H8z M7.5 8l5 5',
    fill: 'M4 9.5L9.5 4l6 6-5.5 5.5a1 1 0 0 1-1.4 0L4 10.9a1 1 0 0 1 0-1.4zM4.5 10h11M16.5 13.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8z',
    picker: 'M12.5 3.5l4 4-2 2-4-4zM11.5 7.5L4.5 14.5V16h1.5l7-7',
    line: 'M4 16L16 4',
    rect: 'M3.5 5h13v10h-13z',
    ellipse: 'M10 4.5c3.6 0 6.5 2.5 6.5 5.5s-2.9 5.5-6.5 5.5S3.5 13 3.5 10 6.4 4.5 10 4.5z',
    undo: 'M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 0 1 0 9H9', redo: 'M13 5l3.5 3.5L13 12M16 8.5H8a4.5 4.5 0 0 0 0 9h3',
    zin: 'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12.5 12.5 17 17M6 8.5h5M8.5 6v5', zout: 'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12.5 12.5 17 17M6 8.5h5',
  };
  const ic = n => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${T[n]}"/></svg>`;
  const wins = new Set();

  async function edit(item) {
    let it = item;
    let dirty = false;
    const aw = host.openWindow({
      title: 'Paint', icon: ICON, width: 1000, height: 700,
      onClose: async () => {
        if (!dirty) return true;
        const v = await host.dialog('Paint', `Do you want to save changes to ${it ? it.name : 'Untitled'}?`,
          [{ label: 'Save', value: 'save' }, { label: "Don't save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }], host.icons32.WARN_ICON);
        if (v === 'cancel') return false;
        if (v === 'save') return await save();
        return true;
      },
    });
    wins.add(aw);
    aw.el._dirty = () => dirty;
    const tools = ['pencil', 'brush', 'eraser', 'fill', 'picker', 'line', 'rect', 'ellipse'];
    const names = { pencil: 'Pencil', brush: 'Brush', eraser: 'Eraser', fill: 'Fill', picker: 'Color picker', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse' };
    aw.body.innerHTML = `
      <div class="pt-ribbon">
        <div class="pt-group pt-tools">${tools.map(t => `<button class="pt-tool" data-tool="${t}" title="${names[t]}">${ic(t)}</button>`).join('')}</div>
        <div class="pt-group">
          <label class="pt-size" title="Size"><span>Size</span><input type="range" min="1" max="64" value="4"><b>4</b></label>
          <label class="pt-fillmode" title="Fill shapes"><input type="checkbox"> Filled</label>
        </div>
        <div class="pt-group pt-colors">
          <div class="pt-current">
            <button class="pt-c1" title="Color 1 (left click)"></button>
            <button class="pt-c2" title="Color 2 (right click)"></button>
          </div>
          <div class="pt-palette">${PALETTE.map(c => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join('')}</div>
          <label class="pt-custom" title="Edit colors"><input type="color" value="#000000"><span>Edit colors</span></label>
        </div>
        <div class="pt-group">
          <button class="pt-tool pt-undo" title="Undo (Ctrl+Z)">${ic('undo')}</button>
          <button class="pt-tool pt-redo" title="Redo (Ctrl+Y)">${ic('redo')}</button>
        </div>
      </div>
      <div class="pt-view"><div class="pt-stage"><canvas class="pt-img"></canvas><canvas class="pt-over"></canvas></div><div class="pt-loading">Loading…</div></div>`;
    const st = aw.status();
    st.innerHTML = `<span class="pt-pos"></span><span class="pt-dim"></span><span class="pt-zoombar"><button class="pt-zbtn" data-z="-">${ic('zout')}</button><b class="pt-zoom">100%</b><button class="pt-zbtn" data-z="+">${ic('zin')}</button><button class="pt-zbtn pt-fit" data-z="fit">Fit</button></span>`;
    const $ = s => aw.el.querySelector(s);
    const view = $('.pt-view'), stage = $('.pt-stage'), img = $('.pt-img'), over = $('.pt-over');
    const ctx = img.getContext('2d', { willReadFrequently: true }), octx = over.getContext('2d');
    let tool = 'brush', size = 4, c1 = '#000000', c2 = '#ffffff', filled = false, zoom = 1;
    const undo = [], redo = [];

    const title = () => aw.setTitle(`${dirty ? '*' : ''}${it ? it.name : 'Untitled'} - Paint`);
    const setDirty = v => { dirty = v; title(); };
    const setSize = (w, h) => {
      img.width = over.width = w; img.height = over.height = h;
      $('.pt-dim').textContent = `${w} × ${h}px`;
      applyZoom();
    };
    function applyZoom() {
      const w = Math.round(img.width * zoom), h = Math.round(img.height * zoom);
      for (const c of [img, over]) { c.style.width = w + 'px'; c.style.height = h + 'px'; }
      stage.style.width = w + 'px'; stage.style.height = h + 'px';
      stage.classList.toggle('pixelated', zoom > 2);
      $('.pt-zoom').textContent = Math.round(zoom * 100) + '%';
    }
    const fit = () => {
      const vw = view.clientWidth - 40, vh = view.clientHeight - 40;
      zoom = Math.max(0.05, Math.min(1, vw / img.width, vh / img.height));
      applyZoom();
    };
    const zoomBy = f => { zoom = Math.max(0.05, Math.min(16, zoom * f)); applyZoom(); };
    const maxUndo = () => Math.max(3, Math.min(25, Math.floor(150e6 / (img.width * img.height * 4))));
    const snap = () => ({ w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height) });
    const restore = s => { setSize(s.w, s.h); ctx.putImageData(s.data, 0, 0); };
    const pushUndo = () => { undo.push(snap()); while (undo.length > maxUndo()) undo.shift(); redo.length = 0; };
    const doUndo = () => { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); setDirty(true); };
    const doRedo = () => { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); setDirty(true); };

    // ---- tools & colors ----
    const selectTool = t => { tool = t; aw.el.querySelectorAll('.pt-tools .pt-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); over.dataset.tool = t; };
    const paintSwatches = () => { $('.pt-c1').style.background = c1; $('.pt-c2').style.background = c2; $('.pt-custom input').value = c1; };
    aw.el.querySelectorAll('.pt-tools .pt-tool').forEach(b => b.onclick = () => selectTool(b.dataset.tool));
    const range = $('.pt-size input');
    range.oninput = () => { size = +range.value; $('.pt-size b').textContent = size; };
    $('.pt-fillmode input').onchange = e => { filled = e.target.checked; };
    aw.el.querySelectorAll('.pt-palette button').forEach(b => {
      b.onclick = () => { c1 = b.dataset.c; paintSwatches(); };
      b.oncontextmenu = e => { e.preventDefault(); c2 = b.dataset.c; paintSwatches(); };
    });
    $('.pt-custom input').oninput = e => { c1 = e.target.value; paintSwatches(); };
    $('.pt-c2').onclick = () => { [c1, c2] = [c2, c1]; paintSwatches(); };
    $('.pt-undo').onclick = doUndo;
    $('.pt-redo').onclick = doRedo;
    aw.el.querySelectorAll('.pt-zbtn').forEach(b => b.onclick = () => (b.dataset.z === 'fit' ? fit() : zoomBy(b.dataset.z === '+' ? 1.25 : 0.8)));
    view.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 0.9); } }, { passive: false });

    // ---- drawing ----
    const toImg = e => {
      const r = over.getBoundingClientRect();
      return { x: Math.floor((e.clientX - r.left) / zoom), y: Math.floor((e.clientY - r.top) / zoom) };
    };
    const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    function floodFill(x, y, color) {
      const w = img.width, h = img.height;
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const d = ctx.getImageData(0, 0, w, h), a = d.data;
      const o = (y * w + x) * 4, tr = a[o], tg = a[o + 1], tb = a[o + 2], ta = a[o + 3];
      const [r, g, b] = rgb(color), tol = 32;
      const match = i => Math.abs(a[i] - tr) <= tol && Math.abs(a[i + 1] - tg) <= tol && Math.abs(a[i + 2] - tb) <= tol && Math.abs(a[i + 3] - ta) <= tol;
      const seen = new Uint8Array(w * h);
      const stack = [x, y];
      while (stack.length) {
        const py = stack.pop();
        let px = stack.pop(), i = py * w + px;
        while (px >= 0 && !seen[i] && match(i * 4)) { px--; i--; }
        px++; i++;
        let up = false, down = false;
        while (px < w && !seen[i] && match(i * 4)) {
          seen[i] = 1;
          const k = i * 4; a[k] = r; a[k + 1] = g; a[k + 2] = b; a[k + 3] = 255;
          if (py > 0) { const u = i - w; if (!seen[u] && match(u * 4)) { if (!up) { stack.push(px, py - 1); up = true; } } else up = false; }
          if (py < h - 1) { const dn = i + w; if (!seen[dn] && match(dn * 4)) { if (!down) { stack.push(px, py + 1); down = true; } } else down = false; }
          px++; i++;
        }
      }
      ctx.putImageData(d, 0, 0);
      return true;
    }
    function shape(c, t, a, b, color, shift) {
      let { x: x2, y: y2 } = b;
      const dx = x2 - a.x, dy = y2 - a.y;
      if (shift && t !== 'line') { const m = Math.max(Math.abs(dx), Math.abs(dy)); x2 = a.x + Math.sign(dx || 1) * m; y2 = a.y + Math.sign(dy || 1) * m; }
      if (shift && t === 'line') {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
        x2 = a.x + Math.round(Math.cos(ang) * len); y2 = a.y + Math.round(Math.sin(ang) * len);
      }
      c.lineWidth = size; c.strokeStyle = c.fillStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      if (t === 'line') { c.moveTo(a.x + .5, a.y + .5); c.lineTo(x2 + .5, y2 + .5); c.stroke(); return; }
      if (t === 'rect') c.rect(Math.min(a.x, x2) + .5, Math.min(a.y, y2) + .5, Math.abs(x2 - a.x), Math.abs(y2 - a.y));
      else c.ellipse((a.x + x2) / 2, (a.y + y2) / 2, Math.abs(x2 - a.x) / 2, Math.abs(y2 - a.y) / 2, 0, 0, Math.PI * 2);
      filled ? c.fill() : c.stroke();
    }
    let drawing = null;
    over.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      over.setPointerCapture(e.pointerId);
      const color = e.button === 2 ? c2 : c1, back = e.button === 2 ? c1 : c2;
      const p = toImg(e);
      if (tool === 'picker') {
        const [r, g, b] = ctx.getImageData(Math.min(p.x, img.width - 1), Math.min(p.y, img.height - 1), 1, 1).data;
        if (e.button === 2) c2 = hex(r, g, b); else c1 = hex(r, g, b);
        paintSwatches();
        return;
      }
      pushUndo();
      if (tool === 'fill') { if (floodFill(p.x, p.y, color)) setDirty(true); else undo.pop(); return; }
      if (['pencil', 'brush', 'eraser'].includes(tool)) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = tool === 'eraser' ? back : color;
        ctx.lineWidth = tool === 'pencil' ? 1 : tool === 'eraser' ? size * 2 : size;
        ctx.beginPath(); ctx.moveTo(p.x + .5, p.y + .5); ctx.lineTo(p.x + .5, p.y + .5); ctx.stroke();
      }
      drawing = { start: p, last: p, color };
      setDirty(true);
    });
    over.addEventListener('pointermove', e => {
      const p = toImg(e);
      $('.pt-pos').textContent = p.x >= 0 && p.y >= 0 && p.x < img.width && p.y < img.height ? `${p.x}, ${p.y}px` : '';
      if (!drawing) return;
      if (['pencil', 'brush', 'eraser'].includes(tool)) {
        ctx.beginPath(); ctx.moveTo(drawing.last.x + .5, drawing.last.y + .5); ctx.lineTo(p.x + .5, p.y + .5); ctx.stroke();
        drawing.last = p;
      } else {
        octx.clearRect(0, 0, over.width, over.height);
        shape(octx, tool, drawing.start, p, drawing.color, e.shiftKey);
      }
    });
    const end = e => {
      if (!drawing) return;
      if (['line', 'rect', 'ellipse'].includes(tool)) {
        octx.clearRect(0, 0, over.width, over.height);
        if (e.type !== 'pointercancel') shape(ctx, tool, drawing.start, toImg(e), drawing.color, e.shiftKey);
      }
      drawing = null;
    };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);
    over.addEventListener('pointerleave', () => { $('.pt-pos').textContent = ''; });
    over.addEventListener('contextmenu', e => e.preventDefault());

    // ---- image operations ----
    function transform(fn) {
      pushUndo();
      const t = document.createElement('canvas');
      t.width = img.width; t.height = img.height;
      t.getContext('2d').drawImage(img, 0, 0);
      const { w, h, draw } = fn(t);
      setSize(w, h);
      ctx.save(); draw(ctx, t); ctx.restore();
      setDirty(true);
    }
    const rotate = dir => transform(t => ({ w: t.height, h: t.width, draw: (c, s) => { c.translate(dir > 0 ? s.height : 0, dir > 0 ? 0 : s.width); c.rotate(dir * Math.PI / 2); c.drawImage(s, 0, 0); } }));
    const flip = horiz => transform(t => ({ w: t.width, h: t.height, draw: (c, s) => { if (horiz) { c.translate(s.width, 0); c.scale(-1, 1); } else { c.translate(0, s.height); c.scale(1, -1); } c.drawImage(s, 0, 0); } }));
    async function resize() {
      const r = await host.form({
        title: 'Resize', ok: 'OK',
        html: `<div class="row"><label class="field">Width<input type="text" name="w" value="${img.width}" inputmode="numeric"></label>
          <label class="field">Height<input type="text" name="h" value="${img.height}" inputmode="numeric"></label></div>
          <label class="row"><input type="checkbox" name="keep" checked> Keep aspect ratio</label>`,
        init: f => {
          const ratio = img.width / img.height;
          f.w.oninput = () => { if (f.keep.checked && +f.w.value) f.h.value = Math.max(1, Math.round(+f.w.value / ratio)); };
          f.h.oninput = () => { if (f.keep.checked && +f.h.value) f.w.value = Math.max(1, Math.round(+f.h.value * ratio)); };
        },
        submit: f => {
          const w = Math.round(+f.w.value), h = Math.round(+f.h.value);
          if (!(w >= 1 && h >= 1 && w <= 8000 && h <= 8000)) return { error: 'Width and height must be between 1 and 8000.' };
          return { w, h };
        },
      });
      if (!r) return;
      transform(() => ({ w: r.w, h: r.h, draw: (c, s) => { c.imageSmoothingQuality = 'high'; c.drawImage(s, 0, 0, r.w, r.h); } }));
      fit();
    }
    const clearAll = () => { pushUndo(); ctx.fillStyle = c2; ctx.fillRect(0, 0, img.width, img.height); setDirty(true); };

    // ---- save ----
    function blobFor(name) {
      const type = ENCODE[extOf(name)];
      if (!type) return Promise.resolve(null);
      let src = img;
      if (type === 'image/jpeg') { // JPEG has no transparency: flatten onto white
        src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
        const c = src.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, img.width, img.height); c.drawImage(img, 0, 0);
      }
      return new Promise(res => src.toBlob(res, type, 0.92));
    }
    async function save() {
      if (!it || !ENCODE[extOf(it.name)]) return saveAs();
      try {
        it = await host.saveFile(it, await blobFor(it.name));
        setDirty(false);
        return true;
      } catch (e) { await host.alert('Paint', e.message); return false; }
    }
    async function saveAs() {
      const suggested = it ? (ENCODE[extOf(it.name)] ? it.name : it.name.replace(/\.[^.]+$/, '') + '.png') : 'Untitled.png';
      const name = await host.form({
        title: 'Save as', ok: 'Save',
        html: `<label class="field">File name<input type="text" name="fname" value="${esc(suggested)}" spellcheck="false" autocomplete="off"></label>
          <span class="hint">Save as .png, .jpg or .webp</span>`,
        init: f => { const dot = suggested.lastIndexOf('.'); f.fname.focus(); f.fname.setSelectionRange(0, dot > 0 ? dot : suggested.length); },
        submit: f => {
          let n = f.fname.value.trim();
          if (!n) return { error: 'Enter a file name.' };
          if (!ENCODE[extOf(n)]) n += '.png';
          return n;
        },
      });
      if (!name) return false;
      const parent = it ? it.parent : host.cwd;
      const near = it ? host.spotNear(it) : host.freeSpots(parent, 1)[0];
      try {
        it = await host.createFile({ name, parent, blob: await blobFor(name), ...near });
        setDirty(false);
        return true;
      } catch (e) { await host.alert('Paint', e.message); return false; }
    }

    aw.menubar([
      { label: 'File', items: () => [
        { label: 'Save', icon: 'save', key: 'Ctrl+S', action: save },
        { label: 'Save as…', key: 'Ctrl+Shift+S', action: saveAs },
        { label: 'Download', icon: 'download', disabled: !it, action: () => it && host.download([it.id]) },
        { sep: true },
        { label: 'Close', key: 'Ctrl+W', action: () => aw.close() },
      ] },
      { label: 'Edit', items: () => [
        { label: 'Undo', key: 'Ctrl+Z', disabled: !undo.length, action: doUndo },
        { label: 'Redo', key: 'Ctrl+Y', disabled: !redo.length, action: doRedo },
        { sep: true },
        { label: 'Clear image', action: clearAll },
      ] },
      { label: 'Image', items: () => [
        { label: 'Resize…', action: resize },
        { sep: true },
        { label: 'Rotate right 90°', action: () => rotate(1) },
        { label: 'Rotate left 90°', action: () => rotate(-1) },
        { label: 'Flip horizontal', action: () => flip(true) },
        { label: 'Flip vertical', action: () => flip(false) },
      ] },
      { label: 'View', items: () => [
        { label: 'Zoom in', key: 'Ctrl++', action: () => zoomBy(1.25) },
        { label: 'Zoom out', key: 'Ctrl+-', action: () => zoomBy(0.8) },
        { label: 'Fit to window', action: fit },
        { label: 'Actual size', key: 'Ctrl+0', action: () => { zoom = 1; applyZoom(); } },
      ] },
    ]);

    aw.el.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
      else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
      else if (mod && k === 'w') { e.preventDefault(); aw.close(); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.25); }
      else if (mod && k === '-') { e.preventDefault(); zoomBy(0.8); }
      else if (mod && k === '0') { e.preventDefault(); zoom = 1; applyZoom(); }
    });
    const origClose = aw.close;
    aw.close = async force => { const ok = await origClose(force); if (ok) wins.delete(aw); return ok; };

    selectTool('brush'); paintSwatches(); title();
    if (it) {
      try {
        const im = new Image();
        im.src = host.fileUrl(it, true);
        await im.decode();
        setSize(im.naturalWidth, im.naturalHeight);
        ctx.drawImage(im, 0, 0);
      } catch {
        await host.alert('Paint', `"${it.name}" could not be opened as an image.`);
        aw.close(true);
        return;
      }
    } else {
      setSize(960, 640);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 960, 640);
    }
    $('.pt-loading').remove();
    requestAnimationFrame(fit);
    aw.el.focus();
  }

  return {
    defaultAction: it => canEdit(it) ? { label: 'Edit in Paint', icon: 'paint', run: () => edit(it) } : null,
    itemMenu: items => items.length === 1 && canEdit(items[0]) ? [{ label: 'Edit in Paint', icon: 'paint', action: () => edit(items[0]) }] : [],
    newMenu: () => [{ label: 'New image', icon: 'image', action: () => edit(null) }],
    disable() { for (const w of wins) w.close(true); wins.clear(); },
    api: { canEdit, edit },
  };
}
