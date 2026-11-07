// Real-time preview: plays the timeline straight from low-res proxies, no rendering needed.
// One <video> per media file; a wall clock is the master and elements are nudged to follow it.
import { S, $, h, on, emit, positions, total, clipDur, mediaFor, cssFilter, clamp } from './store.js';

const videosEl = $('#videos'), stage = $('#stage'), fadeLayer = $('#fadeLayer'), textLayer = $('#textLayer');
// Two <video> elements per media file (A/B). The upcoming clip is pre-seeked on the idle one,
// so cuts — even between two parts of the same file — swap instantly instead of stalling on a seek.
const pool = new Map();      // media id -> [<video>, <video>]
const bound = new Map();     // clip id -> <video> currently holding that clip
const audioPool = new Map(); // audio item id -> <audio>
let wall0 = 0, t0 = 0;
const vignette = h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.65) 100%)', opacity: 0 } });
stage.insertBefore(vignette, fadeLayer);

const urlFor = (m) => (m.proxy ? `/media/proxy/${m.id}` : `/media/source/${m.id}`) + `?v=${m.ready ? 1 : 0}`;
function elsFor(m) {
  let els = pool.get(m.id);
  if (!els) {
    els = [0, 1].map(() => { const el = h('video', { preload: 'auto', playsinline: true }); el.muted = true; videosEl.append(el); return el; });
    pool.set(m.id, els);
  }
  const url = urlFor(m);
  for (const el of els) if (el.dataset.url !== url) { const t = el.currentTime; el.dataset.url = url; el.src = url; if (t) el.currentTime = t; }
  return els;
}
// The element for a clip: keep its existing binding, otherwise take a free one (never one in `busy`).
function videoFor(c, m, busy) {
  const have = bound.get(c.id);
  if (have && !busy.has(have) && pool.get(m.id)?.includes(have)) return have;
  const els = elsFor(m);
  const taken = new Set([...busy, ...[...bound.entries()].filter(([id]) => id !== c.id).map(([, el]) => el)]);
  const el = els.find((e) => !taken.has(e)) || els.find((e) => !busy.has(e)) || els[0];
  bound.set(c.id, el);
  return el;
}
function transformCss(c) {
  const t = c.transform || {};
  const z = Math.max(1, t.zoom || 1);
  const parts = [];
  if (z > 1) parts.push(`scale(${z})`, `translate(${(-(t.x || 0) * (z - 1) / (2 * z) * 100).toFixed(3)}%, ${(-(t.y || 0) * (z - 1) / (2 * z) * 100).toFixed(3)}%)`);
  if (t.rotate) parts.push(`rotate(${t.rotate}deg)`);
  if (c.flip) parts.push('scaleX(-1)');
  return parts.join(' ');
}
function audioFor(a, m) {
  let el = audioPool.get(a.id);
  const url = urlFor(m);
  if (!el) { el = new Audio(); el.preload = 'auto'; audioPool.set(a.id, el); }
  if (el.dataset.url !== url) { el.dataset.url = url; el.src = url; }
  return el;
}

export function layoutStage() {
  const p = S.project;
  if (!p) return;
  const r = p.width / p.height;
  stage.style.aspectRatio = `${p.width} / ${p.height}`;
  stage.style.width = `min(100cqw, calc(100cqh * ${r}))`;
  stage.style.background = p.background || '#000';
  for (const el of [...pool.values()].flat()) el.style.objectFit = p.fit === 'fill' ? 'cover' : 'contain';
}

function syncEl(el, target, rate, playing) {
  if (playing) {
    el.playbackRate = clamp(rate, 0.25, 4);
    if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
  }
}

export function sync() {
  const p = S.project;
  if (!p) return;
  const t = S.t;
  const pos = positions(p);
  $('#emptyStage').hidden = p.clips.length > 0;
  const used = new Set();
  let fade = 0, vig = false;

  let i = -1;
  for (let k = pos.length - 1; k >= 0; k--) if (t >= pos[k].start - 1e-6) { i = k; break; }
  if (i >= 0 && t > pos[i].end) i = -1; // past the end
  if (i >= 0 || (p.clips.length && t >= total(p) - 1e-3)) {
    if (i < 0) i = p.clips.length - 1;
    const layers = [{ i, alpha: 1, z: 2 }];
    if (pos[i].trans > 0 && t < pos[i].start + pos[i].trans && i > 0) {
      layers[0].alpha = clamp((t - pos[i].start) / pos[i].trans, 0, 1);
      layers.push({ i: i - 1, alpha: 1, z: 1 });
    }
    for (const L of layers) {
      const c = p.clips[L.i], m = mediaFor(c.src);
      if (!m) continue;
      const el = videoFor(c, m, used);
      used.add(el);
      const local = clamp(c.start + (t - pos[L.i].start) * c.speed, c.start, Math.max(c.start, c.end - 0.001));
      syncEl(el, local, c.speed, S.playing);
      el.classList.add('on');
      el.style.zIndex = L.z;
      el.style.opacity = L.alpha;
      el.style.filter = cssFilter(c.color);
      el.style.transform = transformCss(c);
      el.style.objectFit = p.fit === 'fill' ? 'cover' : 'contain';
      const into = t - pos[L.i].start, left = pos[L.i].end - t;
      let gain = 1;
      if (c.fadeIn && into < c.fadeIn) gain = Math.min(gain, into / c.fadeIn);
      if (c.fadeOut && left < c.fadeOut) gain = Math.min(gain, left / c.fadeOut);
      if (L.z === 2) { fade = 1 - clamp(gain, 0, 1); vig = !!c.color?.vignette; }
      el.muted = S.muted || !c.hasAudio || c.volume === 0;
      el.volume = clamp(c.volume * gain * (L.z === 2 ? L.alpha : 1 - layers[0].alpha), 0, 1);
    }
  }
  // Pre-roll: park the next clip, already seeked, on an idle element.
  const keep = new Set([...used]);
  const next = i >= 0 ? p.clips[i + 1] : null;
  if (next && pos[i + 1].start - t < 1.5) {
    const m = mediaFor(next.src);
    if (m) {
      const el = videoFor(next, m, used);
      keep.add(el);
      if (!used.has(el)) {
        el.classList.remove('on');
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - next.start) > 0.05 && !el.seeking) el.currentTime = next.start;
      }
    }
  }
  const live = new Set([i, i - 1, i + 1].filter((k) => k >= 0 && p.clips[k]).map((k) => p.clips[k].id));
  for (const id of bound.keys()) if (!live.has(id)) bound.delete(id);
  for (const els of pool.values()) for (const el of els) if (!keep.has(el)) { el.classList.remove('on'); if (!el.paused) el.pause(); }
  fadeLayer.style.opacity = fade;
  vignette.style.opacity = vig ? 1 : 0;

  // Music track
  const dialogue = i >= 0 && p.clips[i]?.hasAudio && p.clips[i].volume > 0;
  const liveAudio = new Set();
  for (const a of p.audio) {
    const m = mediaFor(a.src);
    if (!m) continue;
    const len = a.end - a.start;
    const el = audioFor(a, m);
    liveAudio.add(a.id);
    if (t >= a.at && t < a.at + len) {
      const local = a.start + (t - a.at);
      syncEl(el, local, 1, S.playing);
      let g = a.volume;
      if (a.fadeIn && t - a.at < a.fadeIn) g *= (t - a.at) / a.fadeIn;
      if (a.fadeOut && a.at + len - t < a.fadeOut) g *= (a.at + len - t) / a.fadeOut;
      if (a.duck && dialogue) g *= 0.35;
      el.volume = clamp(g, 0, 1);
      el.muted = S.muted;
    } else if (!el.paused) el.pause();
  }
  for (const [id, el] of audioPool) if (!liveAudio.has(id)) { el.pause(); audioPool.delete(id); }

  renderOverlays();
}

export function renderOverlays() {
  const p = S.project, t = S.t;
  if (!p) return;
  const scale = stage.clientHeight / p.height;
  textLayer.replaceChildren(...p.texts.filter((x) => t >= x.start && t < x.end).map((x) => {
    const el = h('div', { class: `ov-text ${x.box === false ? 'outline' : 'box'} ${S.sel?.id === x.id ? 'sel' : ''}` }, x.text);
    const fam = x.style === 'serif' ? 'Georgia, serif' : x.style === 'mono' ? 'ui-monospace, Menlo, monospace' : 'inherit';
    Object.assign(el.style, { fontSize: `${x.size * scale}px`, color: x.color || '#fff', fontFamily: fam, fontWeight: x.style === 'regular' ? 500 : 900 });
    // Fade only during playback; when paused/scrubbing always show the text so it can be edited.
    if (S.playing) el.style.opacity = clamp(Math.min(1, (t - x.start) / 0.2, (x.end - t) / 0.2), 0, 1);
    if (x.position === 'top') el.style.top = '7%';
    else if (x.position === 'center') { el.style.top = '50%'; el.style.transform = 'translate(-50%, -50%)'; }
    else el.style.bottom = '8%';
    return el;
  }));
}

// rAF when visible; a timer when the tab is hidden so audio keeps playing in sync.
let tick = 0;
function schedule() {
  const my = ++tick;
  const go = () => { if (my === tick) loop(); };
  if (document.hidden) setTimeout(go, 40); else { requestAnimationFrame(go); setTimeout(go, 120); }
}
function loop() {
  if (!S.playing) return;
  S.t = t0 + (performance.now() - wall0) / 1000;
  const end = total();
  if (S.t >= end) { S.t = end; pause(); return; }
  sync();
  emit('time');
  schedule();
}
export function play() {
  if (!S.project.clips.length) return;
  if (S.t >= total() - 0.05) S.t = 0;
  S.playing = true;
  t0 = S.t; wall0 = performance.now();
  sync();
  emit('play');
  schedule();
}
export function pause() {
  S.playing = false;
  for (const els of pool.values()) for (const el of els) el.pause();
  for (const el of audioPool.values()) el.pause();
  sync();
  emit('play');
  emit('time');
}
export const toggle = () => (S.playing ? pause() : play());
export function seek(t) {
  S.t = clamp(t, 0, total());
  if (S.playing) { t0 = S.t; wall0 = performance.now(); }
  sync();
  emit('time');
}

on('change', () => { layoutStage(); if (S.t > total()) S.t = total(); sync(); });
on('select', renderOverlays);
new ResizeObserver(() => { renderOverlays(); }).observe(stage);
