// Notepad module: edit text files
export default function notepad(host) {
  const { esc, svg } = host;
  const ICON = `<svg viewBox="0 0 20 20"><path d="M5 2.5h7l3.5 3.5v11.5h-10.5z" fill="#fff" stroke="#5b8fd1"/><path d="M7.5 9h5M7.5 12h5M7.5 15h3" stroke="#5b8fd1" stroke-linecap="round"/></svg>`;
  const MAX = 5 * 1024 * 1024;
  const canEdit = it => host.isText(it) && it.size <= MAX;
  const wins = new Set();
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('quickdrop.notepad')) || {}; } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('quickdrop.notepad', JSON.stringify(prefs)); } catch {} };
  prefs.wrap ??= true; prefs.zoom ??= 100;

  async function edit(item) {
    let it = item;
    let crlf = false, saved = '';
    const aw = host.openWindow({
      title: 'Notepad', icon: ICON, width: 780, height: 560,
      onClose: async () => {
        if (!dirty()) return true;
        const v = await host.dialog('Notepad', `Do you want to save changes to ${it ? it.name : 'Untitled'}?`,
          [{ label: 'Save', value: 'save' }, { label: "Don't save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }], host.icons32.WARN_ICON);
        if (v === 'cancel') return false;
        if (v === 'save') return await save();
        return true;
      },
    });
    wins.add(aw);
    aw.body.innerHTML = '<textarea class="np-text" spellcheck="false" autocomplete="off"></textarea>';
    const ta = aw.body.querySelector('textarea');
    const st = aw.status();
    st.innerHTML = '<span class="np-msg"></span><span class="np-pos"></span><span class="np-zoom"></span><span class="np-eol"></span><span>UTF-8</span>';
    const dirty = () => ta.value !== saved;
    aw.el._dirty = dirty;
    const title = () => aw.setTitle(`${dirty() ? '*' : ''}${it ? it.name : 'Untitled'} - Notepad`);
    const msg = t => { st.querySelector('.np-msg').textContent = t; };
    const applyView = () => {
      ta.style.whiteSpace = prefs.wrap ? 'pre-wrap' : 'pre';
      ta.style.fontSize = (14 * prefs.zoom / 100) + 'px';
      st.querySelector('.np-zoom').textContent = prefs.zoom + '%';
    };
    const pos = () => {
      const before = ta.value.slice(0, ta.selectionStart).split('\n');
      st.querySelector('.np-pos').textContent = `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`;
      st.querySelector('.np-eol').textContent = crlf ? 'Windows (CRLF)' : 'Unix (LF)';
    };
    const zoom = d => { prefs.zoom = d ? Math.min(500, Math.max(50, prefs.zoom + d)) : 100; savePrefs(); applyView(); };

    async function save() {
      if (!it) return saveAs();
      const text = crlf ? ta.value.replace(/\n/g, '\r\n') : ta.value;
      try {
        it = await host.saveFile(it, new Blob([text], { type: it.mime && it.mime.startsWith('text/') ? it.mime : 'text/plain' }));
        saved = ta.value; title(); msg('Saved');
        setTimeout(() => msg(''), 1500);
        return true;
      } catch (e) { await host.alert('Notepad', e.message); return false; }
    }
    async function saveAs() {
      const suggested = it ? it.name : 'Untitled.txt';
      const name = await host.form({
        title: 'Save as', ok: 'Save',
        html: `<label class="field">File name<input type="text" name="fname" value="${esc(suggested)}" spellcheck="false" autocomplete="off"></label>`,
        init: f => { const dot = suggested.lastIndexOf('.'); f.fname.focus(); f.fname.setSelectionRange(0, dot > 0 ? dot : suggested.length); },
        submit: f => f.fname.value.trim() || { error: 'Enter a file name.' },
      });
      if (!name) return false;
      const text = crlf ? ta.value.replace(/\n/g, '\r\n') : ta.value;
      const parent = it ? it.parent : host.cwd;
      const near = it ? host.spotNear(it) : host.freeSpots(parent, 1)[0];
      try {
        it = await host.createFile({ name, parent, blob: new Blob([text], { type: 'text/plain' }), ...near });
        saved = ta.value; title(); msg('Saved');
        return true;
      } catch (e) { await host.alert('Notepad', e.message); return false; }
    }
    const timeDate = () => {
      const s = new Date().toLocaleString();
      ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    };

    aw.menubar([
      { label: 'File', items: () => [
        { label: 'Save', icon: 'save', key: 'Ctrl+S', action: save },
        { label: 'Save as…', key: 'Ctrl+Shift+S', action: saveAs },
        { label: 'Download', icon: 'download', disabled: !it, action: () => it && host.download([it.id]) },
        { sep: true },
        { label: 'Close', key: 'Ctrl+W', action: () => aw.close() },
      ] },
      { label: 'Edit', items: () => [
        { label: 'Undo', key: 'Ctrl+Z', action: () => { ta.focus(); document.execCommand('undo'); } },
        { sep: true },
        { label: 'Cut', key: 'Ctrl+X', action: () => { ta.focus(); document.execCommand('cut'); } },
        { label: 'Copy', key: 'Ctrl+C', action: () => { ta.focus(); document.execCommand('copy'); } },
        { label: 'Paste', key: 'Ctrl+V', action: async () => { ta.focus(); try { ta.setRangeText(await navigator.clipboard.readText(), ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } catch { msg('Use Ctrl+V to paste'); } } },
        { sep: true },
        { label: 'Select all', key: 'Ctrl+A', action: () => { ta.focus(); ta.select(); } },
        { label: 'Time/Date', key: 'F5', action: timeDate },
      ] },
      { label: 'View', items: () => [
        { label: 'Word wrap', checked: prefs.wrap, action: () => { prefs.wrap = !prefs.wrap; savePrefs(); applyView(); } },
        { sep: true },
        { label: 'Zoom in', key: 'Ctrl++', action: () => zoom(10) },
        { label: 'Zoom out', key: 'Ctrl+-', action: () => zoom(-10) },
        { label: 'Restore default zoom', key: 'Ctrl+0', action: () => zoom(0) },
      ] },
    ]);

    ta.addEventListener('input', () => { title(); pos(); });
    ['keyup', 'click', 'select'].forEach(ev => ta.addEventListener(ev, pos));
    aw.el.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
      else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); aw.close(); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(10); }
      else if (mod && e.key === '-') { e.preventDefault(); zoom(-10); }
      else if (mod && e.key === '0') { e.preventDefault(); zoom(0); }
      else if (e.key === 'F5') { e.preventDefault(); timeDate(); }
      else if (e.key === 'Tab' && !mod) { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    const origClose = aw.close;
    aw.close = async force => { const ok = await origClose(force); if (ok) wins.delete(aw); return ok; };

    applyView(); title(); pos();
    if (it) {
      ta.disabled = true; msg('Loading…');
      try {
        const r = await fetch(host.fileUrl(it, true));
        if (!r.ok) throw new Error(`Could not open "${it.name}".`);
        let text = await r.text();
        crlf = /\r\n/.test(text);
        text = text.replace(/\r\n/g, '\n');
        ta.value = saved = text;
        msg('');
      } catch (e) { msg(e.message); }
      ta.disabled = false;
    }
    title(); pos();
    ta.focus();
    ta.setSelectionRange(0, 0);
  }

  async function newDocument(pos) {
    try {
      const f = await host.createFile({ name: 'New Text Document.txt', parent: pos.parent, blob: new Blob([''], { type: 'text/plain' }), x: pos.x, y: pos.y });
      host.select([f.id]);
      host.startRename(f.id);
    } catch (e) { host.alert('Notepad', e.message); }
  }

  return {
    defaultAction: it => canEdit(it) ? { label: 'Edit', icon: 'edit', run: () => edit(it) } : null,
    itemMenu: items => items.length === 1 && canEdit(items[0]) ? [{ label: 'Edit', icon: 'edit', action: () => edit(items[0]) }] : [],
    newMenu: pos => [{ label: 'New text document', icon: 'notepad', action: () => newDocument(pos) }],
    disable() { for (const w of wins) w.close(true); wins.clear(); },
    api: { canEdit, edit },
  };
}
