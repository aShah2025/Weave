// Timeline UI: ruler, tracks (text / video / music), drag-move, trim, razor, snapping, drop from bin.
import { S, $, h, on, emit, positions, total, clipDur, mediaFor, commit, begin, save, select, selected, clamp, newId, defaultColor, defaultTransform, toast, api, dur } from './store.js';
import { seek, pause } from './player.js';

const scroll = $('#tlScroll'), inner = $('#tlInner'), ruler = $('#ruler');
const textTrack = $('#textTrack'), videoTrack = $('#videoTrack'), audioTrack = $('#audioTrack');
const playhead = $('#playhead'), snapLine = $('#snapLine'), dropMarker = $('#dropMarker');
const TILE_H = 42;

const x2t = (clientX) => (clientX - inner.getBoundingClientRect().left) / S.pps;
const zoomToPps = (v) => 4 * Math.pow(1.07, v);
const ppsToZoom = (pps) => Math.log(pps / 4) / Math.log(1.07);

export function setZoom(v, anchorT = S.t) {
  v = clamp(v, 0, 100);
  const before = anchorT * S.pps - scroll.scrollLeft;
  S.pps = zoomToPps(v);
  $('#zoom').value = v;
  render();
  scroll.scrollLeft = anchorT * S.pps - before;
}
export function zoomFit() {
  const t = Math.max(total(), 5);
  setZoom(ppsToZoom((scroll.clientWidth - 40) / t), 0);
  scroll.scrollLeft = 0;
}

// ---------- waveforms ----------
async function peaksFor(m) {
  if (!m?.hasAudio || !m.ready) return null;
  if (S.peaks.has(m.id)) return S.peaks.get(m.id);
  S.peaks.set(m.id, null);
  try { const p = await api(`/api/peaks/${m.id}`); S.peaks.set(m.id, p); render(); return p; } catch { return null; }
}
// Drawn waveforms are cached by (media, range, size, color), so re-renders and drags just blit them.
const waveCache = new Map();
function drawWave(canvas, m, from, to, color) {
  const pk = S.peaks.get(m?.id);
  if (!pk) { peaksFor(m); return; }
  const w = canvas.width = Math.max(1, Math.min(4096, Math.round(canvas.clientWidth || parseFloat(canvas.style.width) || 100)));
  const hgt = canvas.height = canvas.clientHeight || 22;
  const key = `${m.id}|${from.toFixed(3)}|${to.toFixed(3)}|${w}|${hgt}|${color}`;
  const hit = waveCache.get(key);
  if (hit) { canvas.getContext('2d').drawImage(hit, 0, 0); return; }
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  const a = from * pk.perSec, b = to * pk.perSec;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(a + ((b - a) * x) / w), i1 = Math.max(i0 + 1, Math.floor(a + ((b - a) * (x + 1)) / w));
    let v = 0;
    for (let i = i0; i < i1 && i < pk.data.length; i++) v = Math.max(v, pk.data[i]);
    const bh = Math.max(1, (v / 255) * hgt);
    g.fillRect(x, hgt - bh, 1, bh);
  }
  const copy = document.createElement('canvas');
  copy.width = w; copy.height = hgt;
  copy.getContext('2d').drawImage(canvas, 0, 0);
  waveCache.set(key, copy);
  if (waveCache.size > 300) waveCache.delete(waveCache.keys().next().value);
}

// Coalesce many render requests (drag, trim, live slider) into one per animation frame.
let renderQueued = 0;
export function scheduleRender() {
  if (renderQueued) return;
  renderQueued = requestAnimationFrame(() => { renderQueued = 0; render(); });
}

// ---------- render ----------
function renderRuler(width) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * S.pps >= 70) || 600;
  const minor = major / (major >= 1 ? 5 : 2);
  const frag = [];
  for (let t = 0; t * S.pps < width; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    frag.push(h('div', { class: `tick ${isMajor ? 'major' : ''}`, style: { left: `${t * S.pps}px` } }));
    if (isMajor) frag.push(h('div', { class: 'lbl', style: { left: `${t * S.pps}px` } }, major < 1 ? `${t.toFixed(major < 0.5 ? 2 : 1)}s` : dur(t)));
  }
  ruler.replaceChildren(...frag);
}

function handles() { return [h('div', { class: 'handle l', 'data-edge': 'l' }), h('div', { class: 'handle r', 'data-edge': 'r' })]; }

export function render() {
  const p = S.project;
  if (!p) return;
  const end = total();
  const width = Math.max(scroll.clientWidth, (end + 20) * S.pps);
  inner.style.width = `${width}px`;
  renderRuler(width);
  const pos = positions(p);

  // video track
  const vids = [];
  p.clips.forEach((c, i) => {
    const m = mediaFor(c.src);
    const w = clipDur(c) * S.pps;
    const el = h('div', { class: `item vclip ${S.sel?.id === c.id ? 'sel' : ''}`, 'data-type': 'clip', 'data-id': c.id, style: { left: `${pos[i].start * S.pps}px`, width: `${Math.max(2, w)}px` } });
    const strip = h('div', { class: 'strip' });
    if (m?.thumbs) {
      const tw = Math.round((TILE_H * m.thumbs.w) / m.thumbs.h);
      const n = Math.min(160, Math.ceil(w / tw));
      for (let k = 0; k < n; k++) {
        const srcT = c.start + ((k + 0.5) * tw / S.pps) * c.speed;
        const idx = clamp(Math.floor((srcT / m.duration) * m.thumbs.count), 0, m.thumbs.count - 1);
        strip.append(h('div', { style: { width: `${tw}px`, backgroundImage: `url(/media/thumbs/${m.id})`, backgroundSize: `${m.thumbs.count * tw}px ${TILE_H}px`, backgroundPosition: `${-idx * tw}px 0` } }));
      }
    }
    el.append(strip);
    if (c.hasAudio) {
      const cv = h('canvas', { class: 'wave', style: { width: `${Math.max(2, w)}px` } });
      el.append(cv);
      requestAnimationFrame(() => drawWave(cv, m, c.start, c.end, c.volume === 0 ? '#3d4a50' : '#5fd0c6'));
    }
    const tags = [];
    if (c.speed !== 1) tags.push(`${c.speed}×`);
    if (c.volume === 0) tags.push('muted');
    if (c.color?.look && c.color.look !== 'none') tags.push(c.color.look.replace('_', '/'));
    if (c.fadeIn || c.fadeOut) tags.push('fade');
    if (c.transform && (c.transform.zoom > 1 || c.transform.rotate)) tags.push(c.transform.rotate ? `${c.transform.rotate}°` : `${(+c.transform.zoom).toFixed(1)}× zoom`);
    el.append(h('div', { class: 'label' }, m?.name || 'missing media', ...tags.map((t) => h('span', { class: 'tag' }, t))), ...handles());
    vids.push(el);
    if (pos[i].trans > 0) {
      vids.push(h('div', { class: 'trans-mark', title: `${c.transition.type} · ${c.transition.duration}s (click to edit)`, style: { left: `${pos[i].start * S.pps}px`, width: `${Math.max(8, pos[i].trans * S.pps)}px` }, onclick: (e) => { e.stopPropagation(); select('clip', c.id); emit('focus-transition'); } }));
    }
  });
  videoTrack.replaceChildren(...vids);

  textTrack.replaceChildren(...p.texts.map((t) => h('div', { class: `item tclip ${t.auto ? 'auto' : ''} ${S.sel?.id === t.id ? 'sel' : ''}`, 'data-type': 'text', 'data-id': t.id, style: { left: `${t.start * S.pps}px`, width: `${Math.max(4, (t.end - t.start) * S.pps)}px` } }, t.text.split('\n')[0], ...handles())));

  audioTrack.replaceChildren(...p.audio.map((a) => {
    const m = mediaFor(a.src);
    const w = (a.end - a.start) * S.pps;
    const cv = h('canvas', { class: 'wave', style: { width: `${Math.max(2, w)}px` } });
    requestAnimationFrame(() => drawWave(cv, m, a.start, a.end, '#7ff0b5'));
    return h('div', { class: `item aclip ${S.sel?.id === a.id ? 'sel' : ''}`, 'data-type': 'audio', 'data-id': a.id, style: { left: `${a.at * S.pps}px`, width: `${Math.max(2, w)}px` } },
      h('div', { class: 'label' }, `${m?.name || 'audio'}${a.duck ? ' · ducked' : ''}`), cv, ...handles());
  }));
  updatePlayhead();
  const s = selected();
  $('#selInfo').textContent = s ? `${S.sel.type} ${s.id}` : `${p.clips.length} clips · ${dur(end)}`;
}

export function updatePlayhead() {
  playhead.style.left = `${S.t * S.pps}px`;
  if (S.playing) {
    const x = S.t * S.pps - scroll.scrollLeft;
    if (x > scroll.clientWidth - 60 || x < 0) scroll.scrollLeft = S.t * S.pps - 80;
  }
}

// ---------- snapping ----------
function snapPoints(excludeId) {
  const pts = [0, S.t];
  const pos = positions();
  S.project.clips.forEach((c, i) => { if (c.id !== excludeId) pts.push(pos[i].start, pos[i].end); });
  for (const t of S.project.texts) if (t.id !== excludeId) pts.push(t.start, t.end);
  for (const a of S.project.audio) if (a.id !== excludeId) pts.push(a.at, a.at + a.end - a.start);
  return pts;
}
function snap(t, pts) {
  if (!S.snap) { snapLine.style.display = 'none'; return t; }
  const thr = 8 / S.pps;
  let best = null;
  for (const p of pts) if (Math.abs(p - t) < thr && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
  if (best === null) { snapLine.style.display = 'none'; return t; }
  snapLine.style.display = 'block';
  snapLine.style.left = `${best * S.pps}px`;
  return best;
}

// ---------- editing ops ----------
export function splitAtPlayhead() {
  const t = S.t, pos = positions();
  const sel = S.sel?.type === 'clip' ? S.project.clips.findIndex((c) => c.id === S.sel.id) : -1;
  let i = sel >= 0 && t > pos[sel].start + 0.02 && t < pos[sel].end - 0.02 ? sel : pos.findIndex((x) => t > x.start + 0.02 && t < x.end - 0.02);
  if (i < 0) {
    const tx = S.project.texts.find((x) => t > x.start + 0.05 && t < x.end - 0.05);
    if (tx) return commit((p) => { const r = { ...structuredClone(tx), id: newId('t'), start: t }; tx.end = t; p.texts.push(r); });
    return toast('Nothing under the playhead to split');
  }
  splitClipAt(i, t);
}
function splitClipAt(i, t) {
  const pos = positions();
  commit((p) => {
    const c = p.clips[i];
    const at = c.start + (t - pos[i].start) * c.speed;
    const right = { ...structuredClone(c), id: newId('c'), start: at, fadeIn: 0, transition: null };
    c.end = at; c.fadeOut = 0;
    p.clips.splice(i + 1, 0, right);
    S.sel = { type: 'clip', id: right.id };
  });
}
export function deleteSelection() {
  const s = S.sel;
  if (!s) return;
  commit((p) => {
    if (s.type === 'clip') { p.clips = p.clips.filter((c) => c.id !== s.id); if (p.clips[0]) p.clips[0].transition = null; }
    if (s.type === 'text') p.texts = p.texts.filter((t) => t.id !== s.id);
    if (s.type === 'audio') p.audio = p.audio.filter((a) => a.id !== s.id);
  });
  select(null);
}
export function duplicateSelection() {
  const s = S.sel, o = selected();
  if (!o) return;
  commit((p) => {
    if (s.type === 'clip') { const c = { ...structuredClone(o), id: newId('c'), transition: null }; p.clips.splice(p.clips.indexOf(o) + 1, 0, c); S.sel = { type: 'clip', id: c.id }; }
    if (s.type === 'text') { const d = o.end - o.start; const t = { ...structuredClone(o), id: newId('t'), start: o.end, end: o.end + d }; p.texts.push(t); S.sel = { type: 'text', id: t.id }; }
    if (s.type === 'audio') { const a = { ...structuredClone(o), id: newId('a'), at: o.at + (o.end - o.start) }; p.audio.push(a); S.sel = { type: 'audio', id: a.id }; }
  });
}
export function addMediaToTimeline(m, { index, at } = {}) {
  if (m.kind === 'audio') {
    return commit((p) => { const a = { id: newId('a'), src: m.path, start: 0, end: m.duration, at: at ?? S.t, volume: 0.4, fadeIn: 0, fadeOut: 0, duck: true }; p.audio.push(a); S.sel = { type: 'audio', id: a.id }; });
  }
  commit((p) => {
    if (!p.clips.length && m.width && p.media.length <= 1) { p.width = Math.round(m.width / 2) * 2; p.height = Math.round(m.height / 2) * 2; }
    const c = { id: newId('c'), src: m.path, start: 0, end: m.duration, speed: 1, volume: 1, hasAudio: !!m.hasAudio, fadeIn: 0, fadeOut: 0, transition: null, flip: false, color: defaultColor(), transform: defaultTransform() };
    p.clips.splice(index ?? p.clips.length, 0, c);
    S.sel = { type: 'clip', id: c.id };
  });
}

// ---------- pointer interactions ----------
function insertionIndex(t) {
  const pos = positions();
  let idx = S.project.clips.length;
  for (let i = 0; i < pos.length; i++) if (t < (pos[i].start + pos[i].end) / 2) { idx = i; break; }
  const x = idx < pos.length ? pos[idx].start : total();
  return { idx, x };
}
function showDrop(x, track) {
  const r = track.getBoundingClientRect(), ir = inner.getBoundingClientRect();
  Object.assign(dropMarker.style, { display: 'block', left: `${x * S.pps - 1}px`, top: `${r.top - ir.top + 4}px`, height: `${r.height - 8}px` });
}

inner.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const itemEl = e.target.closest('.item');
  if (e.target.closest('.ruler') || e.target.closest('.ph-head')) return scrub(e);
  if (!itemEl) { if (e.target.closest('.track') && S.sel) select(null); return scrub(e); }
  const type = itemEl.dataset.type, id = itemEl.dataset.id;
  const edge = e.target.dataset.edge;
  if (S.sel?.id !== id) select(type, id);
  const t = x2t(e.clientX);

  if (S.tool === 'razor' && type === 'clip') {
    const i = S.project.clips.findIndex((c) => c.id === id);
    const pos = positions()[i];
    if (t > pos.start + 0.02 && t < pos.end - 0.02) splitClipAt(i, t);
    return;
  }
  if (S.tool === 'razor' && type === 'text') {
    const tx = S.project.texts.find((x) => x.id === id);
    if (t > tx.start + 0.05 && t < tx.end - 0.05) commit((p) => { const r = { ...structuredClone(tx), id: newId('t'), start: t }; tx.end = t; p.texts.push(r); });
    return;
  }
  drag(e, type, id, edge, t);
});

function scrub(e) {
  if (S.playing) pause();
  const move = (ev) => seek(Math.max(0, x2t(ev.clientX)));
  move(e);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function drag(e, type, id, edge, t0) {
  const p = S.project;
  const obj = type === 'clip' ? p.clips.find((c) => c.id === id) : type === 'text' ? p.texts.find((x) => x.id === id) : p.audio.find((a) => a.id === id);
  const orig = structuredClone(obj);
  const m = obj.src ? mediaFor(obj.src) : null;
  const srcDur = m?.duration ?? Infinity;
  const pts = snapPoints(id);
  let started = false, reorder = null;
  const itemEl = () => inner.querySelector(`.item[data-id="${id}"]`);

  const move = (ev) => {
    const t = x2t(ev.clientX);
    const dt = t - t0;
    if (!started) { if (Math.abs(ev.clientX - e.clientX) < 3) return; started = true; begin(); }
    const el = itemEl();
    el?.classList.add('dragging');
    if (type === 'clip') {
      if (edge === 'l') { obj.start = clamp(orig.start + dt * orig.speed, 0, orig.end - 0.1); }
      else if (edge === 'r') {
        const i = p.clips.indexOf(obj), start = positions()[i].start;
        const endT = snap(start + (orig.end - orig.start) / orig.speed + dt, pts);
        obj.end = clamp(orig.start + (endT - start) * orig.speed, orig.start + 0.1, srcDur);
      } else {
        const { idx, x } = insertionIndex(t);
        reorder = idx;
        showDrop(x, videoTrack);
        if (el) el.style.transform = `translateX(${dt * S.pps}px)`;
        return;
      }
    } else if (type === 'text') {
      const d = orig.end - orig.start;
      if (edge === 'l') obj.start = clamp(snap(orig.start + dt, pts), 0, orig.end - 0.1);
      else if (edge === 'r') obj.end = Math.max(orig.start + 0.1, snap(orig.end + dt, pts));
      else { let s = Math.max(0, orig.start + dt); const se = snap(s + d, pts); s = Math.abs(se - (s + d)) > 1e-6 ? se - d : snap(s, pts); obj.start = Math.max(0, s); obj.end = obj.start + d; }
    } else {
      if (edge === 'l') { const ns = clamp(orig.start + dt, 0, orig.end - 0.1); obj.at = Math.max(0, orig.at + (ns - orig.start)); obj.start = ns; }
      else if (edge === 'r') obj.end = clamp(orig.end + dt, orig.start + 0.1, srcDur);
      else obj.at = Math.max(0, snap(orig.at + dt, pts));
    }
    scheduleRender();
    emit('change', { from: 'drag' });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    snapLine.style.display = 'none';
    dropMarker.style.display = 'none';
    if (!started) return;
    if (type === 'clip' && !edge && reorder !== null) {
      const from = p.clips.indexOf(obj);
      let to = reorder > from ? reorder - 1 : reorder;
      if (to !== from) { p.clips.splice(from, 1); p.clips.splice(to, 0, obj); if (p.clips[0]) p.clips[0].transition = null; }
    }
    save();
    render();
    emit('change', { from: 'edit' });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Drag from the media bin
for (const track of [videoTrack, audioTrack]) {
  track.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/weave-media')) return;
    e.preventDefault();
    track.classList.add('over');
    const t = x2t(e.clientX);
    if (track === videoTrack) showDrop(insertionIndex(t).x, track);
    else showDrop(snap(Math.max(0, t), snapPoints()), track);
  });
  track.addEventListener('dragleave', () => { track.classList.remove('over'); dropMarker.style.display = 'none'; snapLine.style.display = 'none'; });
  track.addEventListener('drop', (e) => {
    e.preventDefault();
    track.classList.remove('over');
    dropMarker.style.display = 'none'; snapLine.style.display = 'none';
    const m = S.project.media.find((x) => x.id === e.dataTransfer.getData('text/weave-media'));
    if (!m) return;
    const t = x2t(e.clientX);
    if (track === videoTrack) {
      if (m.kind === 'audio') return addMediaToTimeline(m, { at: 0 });
      addMediaToTimeline(m, { index: insertionIndex(t).idx });
    } else {
      addMediaToTimeline({ ...m, kind: 'audio' }, { at: snap(Math.max(0, t), snapPoints()) });
    }
  });
}

scroll.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(+$('#zoom').value - e.deltaY * 0.05, x2t(e.clientX)); }
}, { passive: false });

$('#zoom').addEventListener('input', (e) => setZoom(+e.target.value));
$('#zoomIn').onclick = () => setZoom(+$('#zoom').value + 8);
$('#zoomOut').onclick = () => setZoom(+$('#zoom').value - 8);
$('#zoomFit').onclick = zoomFit;
$('#splitBtn').onclick = splitAtPlayhead;
$('#deleteBtn').onclick = deleteSelection;
$('#dupBtn').onclick = duplicateSelection;
$('#snapBtn').onclick = () => { S.snap = !S.snap; $('#snapBtn').classList.toggle('active', S.snap); };
export function setTool(tool) {
  S.tool = tool;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  scroll.classList.toggle('razor', tool === 'razor');
}
for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);

on('change', (o) => { if (o?.from === 'inspector') scheduleRender(); else if (o?.from !== 'drag') render(); });
on('time', updatePlayhead);
on('select', render);
new ResizeObserver(() => render()).observe(scroll);
