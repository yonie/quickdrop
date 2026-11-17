// Zip module: compress a selection to .zip, extract archives; optional passwords.
// Runs entirely in the browser with zip.js; the server only stores the results.
export default function zip(host) {
  const { esc, api } = host;
  const isZip = it => it?.type === 'file' && /\.zip$/i.test(it.name);
  const JUNK = new Set(['__MACOSX', '.DS_Store']);
  // same rules as the server: no Windows-reserved, control, direction-override or invisible characters
  const cleanName = n => String(n ?? '').replace(/[\\/:*?"<>|\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, '').trim().slice(0, 200).replace(/^\.+$/, '');
  let lib;
  const zipjs = async () => (lib ||= await import('/vendor/zip/zip.min.js'));
  const passwordError = e => e?.message === lib?.ERR_INVALID_PASSWORD || e?.message === lib?.ERR_ENCRYPTED;

  // Collect an entry's data, refusing more bytes than the archive declared (zip bombs)
  async function readEntry(entry, password, budget) {
    const chunks = [];
    await entry.getData(new WritableStream({
      write(chunk) {
        budget.left -= chunk.length;
        if (budget.left < 0) throw new Error('The archive contains more data than it declares.');
        chunks.push(chunk);
      },
    }), { password });
    return new Blob(chunks);
  }

  // Open the archive, list what it holds, and check the password. Throws { needPassword } when one is missing or wrong.
  async function open(it, password) {
    const z = await zipjs();
    const blob = await (await fetch(host.fileUrl(it))).blob();
    const reader = new z.ZipReader(new z.BlobReader(blob));
    let entries;
    try { entries = await reader.getEntries(); }
    catch { await reader.close().catch(() => {}); throw new Error(`"${it.name}" is not a valid ZIP archive.`); }
    const enc = entries.filter(e => e.encrypted && !e.directory);
    if (enc.length) {
      const fail = msg => { reader.close().catch(() => {}); return Object.assign(new Error(msg), { needPassword: true }); };
      if (!password) throw fail(`"${it.name}" is password protected.`);
      try { await enc[0].getData(new WritableStream(), { password, checkPasswordOnly: true }); }
      catch (e) { if (passwordError(e)) throw fail('The password is incorrect.'); throw e; }
    }
    return { reader, entries };
  }

  async function unpack(it, { reader, entries }, password) {
    const cols = Math.min(8, host.gridCols());
    let list = entries.map(e => ({
      e, dir: e.directory,
      parts: e.filename.split(/[\\/]+/).map(cleanName).filter(p => p && p !== '.' && p !== '..'),
    })).filter(x => x.parts.length && !x.parts.some(p => JUNK.has(p)));
    const base = cleanName(it.name.replace(/\.zip$/i, '')) || 'Archive';
    // "photos.zip" holding only "photos/…" → don't nest photos/photos
    const tops = new Set(list.map(x => x.parts[0]));
    if (tops.size === 1 && [...tops][0].toLowerCase() === base.toLowerCase() && list.some(x => x.parts.length > 1)) {
      list = list.map(x => ({ ...x, parts: x.parts.slice(1) })).filter(x => x.parts.length);
    }
    const files = list.filter(x => !x.dir);
    const total = files.reduce((s, x) => s + (x.e.uncompressedSize || 0), 0);
    const free = Math.max(0, host.state.quota - host.state.used);
    if (total > free) throw new Error(`Not enough space to extract "${it.name}". It needs ${host.fmt(total)}, only ${host.fmt(free)} is free.`);

    const root = await api('POST', '/api/folders', { parent: it.parent, name: base, ...host.spotNear(it) });
    try {
      const slots = new Map(); // folder id -> next grid index
      const nextPos = parent => {
        const k = slots.get(parent) || 0;
        slots.set(parent, k + 1);
        return { x: 12 + (k % cols) * 96, y: 12 + Math.floor(k / cols) * 112 };
      };
      const folders = new Map([['', root.id]]);
      const ensure = async parts => {
        let key = '', parent = root.id;
        for (const p of parts) {
          key += '/' + p;
          if (!folders.has(key)) folders.set(key, (await api('POST', '/api/folders', { parent, name: p, ...nextPos(parent) })).id);
          parent = folders.get(key);
        }
        return parent;
      };
      const byName = (a, b) => a.parts.join('/').localeCompare(b.parts.join('/'), undefined, { numeric: true });
      for (const x of list.filter(x => x.dir).sort(byName)) await ensure(x.parts);
      for (const x of files) await ensure(x.parts.slice(0, -1));

      const budget = { left: total };
      let done = 0;
      for (const x of files.sort(byName)) {
        host.setBusy(`Extracting ${it.name}… ${++done} of ${files.length}`);
        const parent = await ensure(x.parts.slice(0, -1));
        let blob;
        try { blob = await readEntry(x.e, password, budget); }
        catch (e) { if (passwordError(e)) throw Object.assign(new Error('The password is incorrect.'), { needPassword: true }); throw e; }
        await host.createFile({
          name: x.parts[x.parts.length - 1], parent, blob, ...nextPos(parent),
          mtime: x.e.lastModDate?.getTime?.() || Date.now(),
        });
      }
      return root;
    } catch (e) {
      // leave nothing half-extracted behind
      await api('POST', '/api/delete', { ids: [root.id], permanent: true }).catch(() => {});
      throw e.needPassword ? e : new Error(`Could not extract "${it.name}": ${e.message}`);
    } finally {
      await reader.close().catch(() => {});
    }
  }

  async function extract(it) {
    const run = async password => {
      host.setBusy(`Extracting ${it.name}…`);
      try { return await unpack(it, await open(it, password), password); }
      finally { host.setBusy(''); }
    };
    try {
      let folder;
      try { folder = await run(); }
      catch (e) {
        if (!e.needPassword) throw e;
        folder = await host.form({
          title: 'Password needed', ok: 'Extract', icon: host.icons32.LOCK_ICON,
          html: `<p style="margin:0">"${esc(it.name)}" is password protected. Enter the password to extract it.</p>
            <label class="field">Password<input type="password" name="pw" autocomplete="off" autofocus></label>`,
          submit: async f => {
            try { return await run(f.pw.value); }
            catch (err) { if (err.needPassword) return { error: err.message }; throw err; }
          },
        });
        if (!folder) return;
      }
      await host.load();
      host.select([folder.id]);
    } catch (e) {
      host.alert('Extract', e.message);
    } finally { host.setBusy(''); }
  }

  async function build(items, { name, parent, password, encryption, x, y }) {
    const z = await zipjs();
    const entries = [];
    const seen = new Set();
    const walk = (it, prefix) => {
      if (seen.has(it.id)) return;
      seen.add(it.id);
      const p = prefix + it.name;
      if (it.type === 'folder') {
        entries.push({ path: p + '/', dir: true, mtime: it.mtime });
        for (const c of host.children(it.id)) walk(c, p + '/');
      } else entries.push({ path: p, item: it, size: it.size, mtime: it.mtime });
    };
    items.forEach(it => walk(it, ''));
    const free = () => Math.max(0, host.state.quota - host.state.used);
    const estimate = entries.reduce((s, e) => s + (e.size || 0) + 200 + e.path.length * 2, 1024);
    if (estimate > free()) throw new Error(`Not enough space to create "${name}". It may need up to ${host.fmt(estimate)}, only ${host.fmt(free())} is free.`);

    const writer = new z.ZipWriter(new z.BlobWriter('application/zip'), {
      password, zipCrypto: !!password && encryption === 'zipcrypto', encryptionStrength: 3, level: 6,
    });
    let done = 0;
    const files = entries.filter(e => !e.dir).length;
    for (const e of entries) {
      const lastModDate = new Date(e.mtime || Date.now());
      if (e.dir) { await writer.add(e.path, undefined, { directory: true, lastModDate }); continue; }
      host.setBusy(`Compressing… ${++done} of ${files}`);
      const r = await fetch(host.fileUrl(e.item));
      if (!r.ok) throw new Error(`"${e.item.name}" could not be read.`);
      await writer.add(e.path, new z.BlobReader(await r.blob()), { lastModDate });
    }
    const blob = await writer.close();
    if (blob.size > free()) throw new Error(`Not enough space for "${name}" (${host.fmt(blob.size)}).`);
    return host.createFile({ name, parent, blob, x, y });
  }

  async function compress(items) {
    const first = items[0];
    const base = items.length === 1 ? first.name.replace(/\.[^.]+$/, '') || first.name : (host.cwd ? host.state.items.get(host.cwd)?.name : 'Archive') || 'Archive';
    const anchor = items.reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x > a.x) ? b : a));
    const res = await host.form({
      title: 'Compress to ZIP file', ok: 'Create',
      html: `
        <label class="field">File name<input type="text" name="fname" value="${esc(base)}.zip" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>Password <span class="hint">(optional)</span></span><input type="password" name="pw" autocomplete="new-password"></label>
        <label class="field enc" hidden>Encryption
          <select name="enc">
            <option value="aes">AES-256: strong, opens with 7-Zip</option>
            <option value="zipcrypto">ZipCrypto: weak, opens in Windows Explorer</option>
          </select>
        </label>
        <span class="hint">${items.length === 1 ? esc(first.name) : `${items.length} items`}</span>`,
      init: f => {
        const n = f.fname; n.focus(); n.setSelectionRange(0, n.value.length - 4);
        f.pw.addEventListener('input', () => { f.querySelector('.enc').hidden = !f.pw.value; });
      },
      submit: async f => {
        let name = cleanName(f.fname.value);
        if (!name) return { error: 'Enter a file name.' };
        if (!/\.zip$/i.test(name)) name += '.zip';
        host.setBusy(`Compressing ${items.length} item${items.length === 1 ? '' : 's'}…`);
        try {
          return await build(items, {
            name, parent: host.cwd, password: f.pw.value || undefined, encryption: f.enc.value, ...host.spotNear(anchor),
          });
        } catch (e) { return { error: e.message }; }
        finally { host.setBusy(''); }
      },
    });
    if (!res) return;
    await host.load();
    host.select([res.id]);
  }

  return {
    defaultAction: it => isZip(it) ? { label: 'Extract here', icon: 'extract', run: () => extract(it) } : null,
    itemMenu: items => items.length === 1 && isZip(items[0])
      ? [{ label: 'Extract here', icon: 'extract', action: () => extract(items[0]) }]
      : [{ label: 'Compress to ZIP file', icon: 'zip', group: 'send', action: () => compress(items) }],
    api: { extract, compress },
  };
}
