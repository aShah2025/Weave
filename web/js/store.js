// Shared editor state, undo/redo, persistence and tiny helpers.
export const S = {
  project: null, rev: 0, clientId: crypto.randomUUID(),
  sel: null,              // {type: 'clip'|'text'|'audio', id}
  t: 0, playing: false, muted: false,
  pps: 50, tool: 'select', snap: true,
  undo: [], redo: [],
  settings: {}, sw: null, looks: [], transitions: [], aspects: [],
  busy: false, chat: [], peaks: new Map(), dirty: false,
};

const listeners = {};
export const on = (e, f) => (listeners[e] ??= []).push(f);
export const emit = (e, ...a) => listeners[e]?.forEach((f) => f(...a));

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};

export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {},
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

// ---- timeline math (mirrors src/timeline.js) ----
export const clipDur = (c) => (c.end - c.start) / c.speed;
export function positions(p = S.project) {
  const out = [];
  let end = 0;
  p.clips.forEach((c, i) => {
    let tr = 0;
    if (i > 0 && c.transition) tr = Math.max(0, Math.min(c.transition.duration, clipDur(c) / 2, clipDur(p.clips[i - 1]) / 2));
    const s = i === 0 ? 0 : end - tr;
    end = s + clipDur(c);
    out.push({ start: s, end, trans: tr });
  });
  return out;
}
export const total = (p = S.project) => { const pos = positions(p); return pos.length ? pos[pos.length - 1].end : 0; };
export const mediaFor = (src) => S.project.media.find((m) => m.path === src);
export const defaultColor = () => ({ brightness: 0, contrast: 1, saturation: 1, gamma: 1, temperature: 6500, look: 'none', vignette: false, sharpen: 0 });
export const newId = (prefix) => `${prefix}${S.project.nextId++}`;
export const defaultTransform = () => ({ zoom: 1, x: 0, y: 0, rotate: 0 });

export function selected() {
  const s = S.sel;
  if (!s || !S.project) return null;
  const list = s.type === 'clip' ? S.project.clips : s.type === 'text' ? S.project.texts : S.project.audio;
  return list.find((x) => x.id === s.id) || null;
}
export function select(type, id) { S.sel = type ? { type, id } : null; emit('select'); }

// ---- undo / persistence ----
const snap = () => JSON.stringify({ ...S.project, media: undefined });
export function checkpoint(serialized = snap()) {
  S.undo.push(serialized);
  if (S.undo.length > 150) S.undo.shift();
  S.redo = [];
}
// Run a mutation as one undoable step.
export function commit(fn, { silentInspector = false } = {}) {
  checkpoint();
  fn(S.project);
  save();
  emit('change', { from: silentInspector ? 'inspector' : 'edit' });
}
// For continuous gestures (slider / drag): call begin() once, mutate freely, then save().
export const begin = () => checkpoint();

function restore(json) {
  const media = S.project.media;
  S.project = { ...JSON.parse(json), media };
  if (!selected()) S.sel = null;
  save();
  emit('change', { from: 'undo' });
}
export function undo() { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); }
export function redo() { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); }

let saveT;
export function save() {
  S.dirty = true;
  emit('saving', true);
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try {
      await api('/api/project', { method: 'PUT', body: { project: S.project, clientId: S.clientId } });
      S.dirty = false;
      emit('saving', false);
    } catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  }, 250);
}

// ---- formatting ----
export function tc(t, fps = S.project?.fps || 30) {
  t = Math.max(0, t || 0);
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = Math.floor(t % 60), ff = Math.floor((t % 1) * fps);
  const p = (n) => String(n).padStart(2, '0');
  return `${hh ? `${p(hh)}:` : ''}${p(mm)}:${p(ss)}:${p(ff)}`;
}
export const dur = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function toast(msg, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3000);
}

// CSS approximation of the ffmpeg color pipeline, for real-time preview.
const LOOK_CSS = {
  none: '', cinematic: 'contrast(1.12) saturate(0.9) sepia(0.08) hue-rotate(-6deg)', warm: 'sepia(0.25) saturate(1.1)',
  cool: 'saturate(0.95) hue-rotate(-12deg) brightness(1.02)', vintage: 'sepia(0.35) contrast(0.9) saturate(0.8) brightness(1.05)',
  bw: 'grayscale(1) contrast(1.1)', vivid: 'saturate(1.35) contrast(1.08)', faded: 'contrast(0.84) saturate(0.75) brightness(1.06)',
  teal_orange: 'contrast(1.06) saturate(1.15) hue-rotate(-8deg) sepia(0.12)',
};
export function cssFilter(color) {
  const c = { ...defaultColor(), ...(color || {}) };
  const f = [LOOK_CSS[c.look] || ''];
  if (c.brightness) f.push(`brightness(${(1 + c.brightness).toFixed(3)})`);
  if (c.contrast !== 1) f.push(`contrast(${c.contrast})`);
  if (c.saturation !== 1) f.push(`saturate(${c.saturation})`);
  if (c.gamma !== 1) f.push(`brightness(${Math.pow(c.gamma, 0.35).toFixed(3)})`);
  if (c.temperature < 6500) f.push(`sepia(${((6500 - c.temperature) / 9000).toFixed(3)})`);
  if (c.temperature > 6500) f.push(`hue-rotate(${(-(c.temperature - 6500) / 5500 * 14).toFixed(1)}deg) saturate(1.05)`);
  return f.filter(Boolean).join(' ') || 'none';
}
