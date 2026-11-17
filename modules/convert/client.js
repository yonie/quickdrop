// Convert module: right-click > Convert to ▸. Everything runs in the browser:
// images via canvas, PDFs written by hand, PDF pages via pdf.js, audio via Web Audio (+ lamejs for MP3).
export default function convert(host) {
  const { extOf } = host;
  const IMG = 'png jpg jpeg webp gif bmp avif heic heif'.split(' ');
  const AUD = 'mp3 wav flac m4a aac ogg oga opus'.split(' ');
  const VID = 'mp4 mov m4v webm mkv'.split(' ');
  const FORMATS = [
    { id: 'jpg', label: 'JPG image', to: 'jpg', from: IMG },
    { id: 'png', label: 'PNG image', to: 'png', from: IMG },
    { id: 'webp', label: 'WEBP image', to: 'webp', from: IMG },
    { id: 'img-pdf', label: 'PDF document', to: 'pdf', from: IMG },
    { id: 'img-pdf-one', label: 'One PDF with all images', to: 'pdf', from: IMG, combine: true },
    { id: 'pdf-png', label: 'PNG images (one per page)', to: 'png', from: ['pdf'], pages: true },
    { id: 'mp3', label: 'MP3 audio', to: 'mp3', from: [...AUD, ...VID] },
    { id: 'wav', label: 'WAV audio', to: 'wav', from: [...AUD, ...VID] },
  ];
  const same = (ext, to) => (ext === 'jpeg' ? 'jpg' : ext) === to;
  const baseOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
  const tick = () => new Promise(r => setTimeout(r, 0));
  const fetchBlob = async it => {
    const r = await fetch(host.fileUrl(it, true));
    if (!r.ok) throw new Error('could not be read');
    return r.blob();
  };

  // ---------- images ----------
  async function decodeImage(it) {
    const blob = await fetchBlob(it);
    try { return await createImageBitmap(blob); }
    catch { throw new Error(/heic|heif/.test(extOf(it.name)) ? "this browser can't read HEIC photos (Safari can)" : "this browser can't read this image"); }
  }
  function toCanvas(bmp, flatten) {
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    if (flatten) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } // JPG/PDF have no transparency
    g.drawImage(bmp, 0, 0);
    return c;
  }
  async function encode(canvas, type, quality) {
    const blob = await new Promise(r => canvas.toBlob(r, type, quality));
    if (!blob || blob.type !== type) throw new Error(`this browser can't create ${type.split('/')[1].toUpperCase()} files`);
    return blob;
  }

  // Minimal PDF: one page per JPEG, page size = image size at 96 dpi
  function makePdf(pages) {
    const enc = new TextEncoder(), parts = [], offsets = [];
    let len = 0;
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body, stream) => {
      offsets[n] = len;
      put(`${n} 0 obj\n${body}\n`);
      if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
      put('endobj\n');
    };
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    pages.forEach((p, i) => {
      const o = 3 + i * 3, w = +(p.w * 0.75).toFixed(2), h = +(p.h * 0.75).toFixed(2);
      const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
      obj(o, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${o + 1} 0 R >> >> /Contents ${o + 2} 0 R >>`);
      obj(o + 1, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
      obj(o + 2, `<< /Length ${content.length} >>`, content);
    });
    const count = 3 + n * 3, xref = len;
    put(`xref\n0 ${count}\n0000000000 65535 f \n` + offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
    put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function pdfPage(it) {
    const bmp = await decodeImage(it);
    const jpeg = new Uint8Array(await (await encode(toCanvas(bmp, true), 'image/jpeg', 0.92)).arrayBuffer());
    return { jpeg, w: bmp.width, h: bmp.height };
  }

  // ---------- PDF → PNG pages ----------
  async function pdfToPngs(it, onPage) {
    const pdfjs = await host.loadPdfjs();
    const task = pdfjs.getDocument({ url: host.fileUrl(it, true), isEvalSupported: false });
    try {
      const doc = await task.promise;
      const out = [];
      for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
        const page = await doc.getPage(n);
        const v1 = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1600 / v1.width) });
        const c = document.createElement('canvas');
        c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, viewport }).promise;
        out.push(await encode(c, 'image/png'));
        onPage(n, doc.numPages);
      }
      return out;
    } finally { task.destroy(); }
  }

  // ---------- audio ----------
  async function decodeAudio(it) {
    const data = await (await fetchBlob(it)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100); // decodes and resamples to 44.1 kHz
    try { return await ctx.decodeAudioData(data); }
    catch { throw new Error(VID.includes(extOf(it.name)) ? 'no sound found, or this browser can\'t read this video' : "this browser can't read this audio file"); }
  }
  function toWav(buf) {
    const ch = Math.min(2, buf.numberOfChannels), n = buf.length, rate = buf.sampleRate;
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * ch * 2, true);
    const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([out.buffer], { type: 'audio/wav' });
  }
  let lame;
  async function toMp3(buf, onProgress) {
    lame ||= await import('/vendor/lamejs/lamejs.js');
    const ch = Math.min(2, buf.numberOfChannels), n = buf.length;
    const enc = new lame.Mp3Encoder(ch, buf.sampleRate, 192);
    const to16 = f => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
    const L = to16(buf.getChannelData(0)), R = ch > 1 ? to16(buf.getChannelData(1)) : null;
    const chunks = [];
    for (let i = 0, k = 0; i < n; i += 1152, k++) {
      const d = R ? enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152)) : enc.encodeBuffer(L.subarray(i, i + 1152));
      if (d.length) chunks.push(new Uint8Array(d));
      if (k % 400 === 0) { onProgress(i / n); await tick(); } // keep the page responsive
    }
    const end = enc.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  // ---------- running ----------
  function options(items) {
    if (!items.length || items.some(i => i.type !== 'file')) return [];
    const exts = items.map(i => extOf(i.name));
    return FORMATS.filter(f => exts.every(e => f.from.includes(e)) &&
      (f.combine ? items.length >= 2 : !exts.every(e => same(e, f.to))));
  }

  async function run(items, f) {
    const todo = f.combine ? items : items.filter(i => !same(extOf(i.name), f.to));
    const taken = [];
    const near = it => { const p = host.spotNear(it, taken); taken.push(p); return p; };
    const errors = [], created = [];
    const busy = (i, extra = '') => host.setBusy(`Converting${todo.length > 1 && !f.combine ? ` ${i + 1} of ${todo.length}` : ''} to ${f.label}…${extra}`);
    try {
      if (f.combine) {
        busy(0);
        const pages = [];
        for (const [i, it] of todo.entries()) {
          try { pages.push(await pdfPage(it)); } catch (e) { errors.push(`${it.name}: ${e.message}`); }
          busy(0, ` ${i + 1} of ${todo.length}`);
        }
        if (pages.length) {
          const anchor = todo.reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x > a.x) ? b : a));
          created.push(await host.createFile({ name: `${baseOf(todo[0].name)} and more.pdf`, parent: todo[0].parent, blob: makePdf(pages), ...near(anchor) }));
        }
      } else {
        for (const [i, it] of todo.entries()) {
          busy(i);
          try {
            const name = `${baseOf(it.name)}.${f.to}`;
            let blob;
            if (f.pages) {
              const pngs = await pdfToPngs(it, (n, total) => busy(i, ` page ${n} of ${total}`));
              const folder = await host.api('POST', '/api/folders', { name: `${baseOf(it.name)} pages`, parent: it.parent, ...near(it) });
              created.push(folder);
              const cols = 6;
              for (const [k, png] of pngs.entries()) {
                await host.createFile({ name: `Page ${k + 1}.png`, parent: folder.id, blob: png, x: 12 + (k % cols) * 96, y: 12 + Math.floor(k / cols) * 112 });
              }
              continue;
            } else if (f.to === 'pdf') blob = makePdf([await pdfPage(it)]);
            else if (f.to === 'mp3') blob = await toMp3(await decodeAudio(it), p => busy(i, ` ${Math.round(p * 100)}%`));
            else if (f.to === 'wav') blob = toWav(await decodeAudio(it));
            else {
              const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[f.to];
              blob = await encode(toCanvas(await decodeImage(it), f.to === 'jpg'), type, f.to === 'png' ? undefined : 0.9);
            }
            created.push(await host.createFile({ name, parent: it.parent, blob, ...near(it) }));
          } catch (e) { errors.push(`${it.name}: ${e.message}`); }
        }
      }
    } finally { host.setBusy(''); }
    await host.load();
    if (created.length) host.select(created.map(c => c.id));
    if (errors.length) host.alert('Convert', (errors.length === 1 ? '' : `${errors.length} files could not be converted:\n\n`) + errors.slice(0, 8).join('\n'));
  }

  return {
    itemMenu: items => {
      const opts = options(items);
      return opts.length ? [{ label: 'Convert to', icon: 'convert', group: 'send', items: opts.map(f => ({ label: f.label, action: () => run(items, f) })) }] : [];
    },
    api: { options, run },
  };
}
