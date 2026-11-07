// Project model. Plain JSON so the agent, the UI and humans can all read and diff it.
//
//   clips   – the main (magnetic) video track; clips play back to back. In/out are SOURCE seconds.
//             A clip may carry `transition` = {type, duration} blending it with the previous clip.
//   audio   – music / voice-over track; each item is placed at an absolute TIMELINE time (`at`).
//   texts   – captions / titles in TIMELINE seconds.
import fs from 'node:fs';

export const TRANSITIONS = ['fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'radial', 'smoothleft', 'zoomin', 'fadeblack', 'fadewhite'];
export const LOOKS = ['none', 'cinematic', 'warm', 'cool', 'vintage', 'bw', 'vivid', 'faded', 'teal_orange'];
export const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '21:9': [2560, 1080] };

export function newProject() {
  return { version: 2, name: 'Untitled', width: 1920, height: 1080, fps: 30, fit: 'fit', background: '#000000', media: [], clips: [], audio: [], texts: [], nextId: 1 };
}

// Upgrade v1 projects (CLI era) in place.
export function migrate(p) {
  if (!p.version || p.version < 2) {
    p.version = 2; p.name ??= 'Untitled'; p.fit ??= 'fit'; p.background ??= '#000000';
    p.media ??= []; p.audio ??= []; p.texts ??= [];
  }
  for (const c of p.clips) { c.color ??= defaultColor(); c.transform ??= defaultTransform(); c.transition ??= null; c.flip ??= false; c.fadeIn ??= 0; c.fadeOut ??= 0; }
  p.normalize ??= false;
  return p;
}

export const defaultColor = () => ({ brightness: 0, contrast: 1, saturation: 1, gamma: 1, temperature: 6500, look: 'none', vignette: false, sharpen: 0 });
// zoom >= 1 punches in; x / y pan the punched-in frame from -1 (left/top edge) to 1 (right/bottom edge).
export const defaultTransform = () => ({ zoom: 1, x: 0, y: 0, rotate: 0 });
export const isDefaultTransform = (t) => !t || (t.zoom === 1 && !t.x && !t.y && !t.rotate);

export const clipDuration = (c) => (c.end - c.start) / c.speed;

// Effective transition length (can't exceed half of either neighbour).
function transLen(p, i) {
  const c = p.clips[i];
  if (i === 0 || !c.transition) return 0;
  return Math.max(0, Math.min(c.transition.duration, clipDuration(c) / 2, clipDuration(p.clips[i - 1]) / 2));
}

// Timeline [start, end) of every clip, accounting for transition overlaps.
export function positions(p) {
  const out = [];
  let end = 0;
  p.clips.forEach((c, i) => {
    const s = i === 0 ? 0 : end - transLen(p, i);
    end = s + clipDuration(c);
    out.push({ start: s, end, trans: transLen(p, i) });
  });
  return out;
}

export function totalDuration(p) {
  const pos = positions(p);
  const video = pos.length ? pos[pos.length - 1].end : 0;
  return video;
}

export function findClip(p, id) {
  const c = p.clips.find((c) => c.id === id);
  if (!c) throw new Error(`No clip "${id}". Existing: ${p.clips.map((c) => c.id).join(', ') || '(none)'}`);
  return c;
}
export function findAudio(p, id) {
  const a = p.audio.find((a) => a.id === id);
  if (!a) throw new Error(`No audio item "${id}". Existing: ${p.audio.map((a) => a.id).join(', ') || '(none)'}`);
  return a;
}

export function registerMedia(p, info) {
  let m = p.media.find((m) => m.path === info.path);
  // Media ids are random (not nextId) so server-side imports never collide with ids the UI allocates.
  if (!m) { m = { id: `m${Math.random().toString(36).slice(2, 8)}`, ...info }; p.media.push(m); } else Object.assign(m, info);
  return m;
}

export function addClip(p, { src, start, end, probe, index }) {
  start = Math.max(0, start ?? 0);
  end = Math.min(end ?? probe.duration, probe.duration);
  if (!(end > start)) throw new Error(`end must be greater than start (source is 0..${probe.duration.toFixed(2)}s)`);
  if (!probe.hasVideo) throw new Error('This file has no video stream; use add_music for audio files.');
  const clip = {
    id: `c${p.nextId++}`, src, start, end, speed: 1, volume: 1, hasAudio: probe.hasAudio,
    fadeIn: 0, fadeOut: 0, transition: null, flip: false, color: defaultColor(), transform: defaultTransform(),
  };
  if (p.clips.length === 0 && probe.width && p.media.length <= 1) { p.width = even(probe.width); p.height = even(probe.height); }
  p.clips.splice(index ?? p.clips.length, 0, clip);
  return clip;
}

export function addAudio(p, { src, start, end, at, probe, volume = 1 }) {
  if (!probe.hasAudio) throw new Error('That file has no audio stream');
  start = Math.max(0, start ?? 0);
  end = Math.min(end ?? probe.duration, probe.duration);
  const item = { id: `a${p.nextId++}`, src, start, end, at: Math.max(0, at ?? 0), volume, fadeIn: 0, fadeOut: 0, duck: false };
  p.audio.push(item);
  return item;
}

// Split a clip at a SOURCE time. Returns [left, right].
export function splitClip(p, id, at) {
  const c = findClip(p, id);
  if (!(at > c.start + 0.01 && at < c.end - 0.01)) throw new Error(`split point must be inside (${c.start.toFixed(2)}, ${c.end.toFixed(2)}) source seconds`);
  const right = structuredClone(c);
  Object.assign(right, { id: `c${p.nextId++}`, start: at, fadeIn: 0, transition: null });
  c.end = at; c.fadeOut = 0;
  p.clips.splice(p.clips.indexOf(c) + 1, 0, right);
  return [c, right];
}

// Split whatever clip is under a TIMELINE time.
export function splitAt(p, t) {
  const pos = positions(p);
  const i = pos.findIndex((x) => t > x.start + 0.01 && t < x.end - 0.01);
  if (i < 0) throw new Error(`No clip under ${t.toFixed(2)}s`);
  const c = p.clips[i];
  return splitClip(p, c.id, c.start + (t - pos[i].start) * c.speed);
}

// Delete a span of TIMELINE time, rippling later content earlier.
export function removeRange(p, from, to) {
  if (!(to > from)) throw new Error('to must be greater than from');
  const pos = positions(p);
  const out = [];
  let dropNextTransition = false;
  p.clips.forEach((c, i) => {
    const { start: a, end: b } = pos[i];
    if (dropNextTransition) { c.transition = null; dropNextTransition = false; }
    if (b <= from || a >= to) { out.push(c); return; }
    const keepLeft = from > a, keepRight = to < b;
    const toSrc = (x) => c.start + (x - a) * c.speed;
    if (keepLeft) out.push({ ...structuredClone(c), end: toSrc(from), fadeOut: 0 });
    if (keepRight) out.push({ ...structuredClone(c), id: keepLeft ? `c${p.nextId++}` : c.id, start: toSrc(to), fadeIn: 0, transition: keepLeft ? null : null });
    if (!keepRight) dropNextTransition = true;
  });
  const removed = to - from;
  p.clips = out.filter((c) => c.end - c.start > 0.02);
  const shift = (x) => {
    const s = x.start >= to ? x.start - removed : Math.min(x.start, from);
    const e = x.end >= to ? x.end - removed : Math.min(x.end, from);
    return { ...x, start: s, end: e };
  };
  p.texts = p.texts.map(shift).filter((x) => x.end - x.start > 0.05);
  for (const a of p.audio) if (a.at >= to) a.at -= removed; else if (a.at > from) a.at = from;
  return removed;
}

export function addText(p, t) {
  if (!(t.end > t.start)) throw new Error('end must be greater than start');
  const text = { id: `t${p.nextId++}`, position: 'bottom', size: 56, color: '#ffffff', box: true, style: 'bold', ...t };
  p.texts.push(text);
  return text;
}

export function save(p, file) { fs.writeFileSync(file, JSON.stringify(p, null, 2)); }
export function load(file) { return migrate(JSON.parse(fs.readFileSync(file, 'utf8'))); }

const r2 = (n) => +n.toFixed(2);
const even = (n) => Math.round(n / 2) * 2;

// Compact, model-friendly description of the timeline.
export function describe(p) {
  const pos = positions(p);
  const clips = p.clips.map((c, i) => {
    const row = { id: c.id, index: i, src: c.src, src_range: [r2(c.start), r2(c.end)], timeline_range: [r2(pos[i].start), r2(pos[i].end)] };
    if (c.speed !== 1) row.speed = c.speed;
    if (c.volume !== 1) row.volume = c.volume;
    if (c.fadeIn) row.fadeIn = c.fadeIn;
    if (c.fadeOut) row.fadeOut = c.fadeOut;
    if (c.transition) row.transition = c.transition;
    if (c.flip) row.flip = true;
    if (!isDefaultTransform(c.transform)) row.transform = c.transform;
    const d = defaultColor();
    const color = Object.fromEntries(Object.entries(c.color || {}).filter(([k, v]) => d[k] !== v));
    if (Object.keys(color).length) row.color = color;
    return row;
  });
  return {
    resolution: `${p.width}x${p.height}`, fps: p.fps, fit: p.fit, normalize_audio: !!p.normalize,
    total_duration: r2(totalDuration(p)), clips,
    audio: p.audio.map((a) => ({ ...a, src_range: [r2(a.start), r2(a.end)], timeline_range: [r2(a.at), r2(a.at + a.end - a.start)] })),
    texts: p.texts,
  };
}
