// Project model. Plain JSON so the agent (and humans) can inspect and diff it.
// clips play back-to-back in array order; texts are positioned in OUTPUT time.
import fs from 'node:fs';

export function newProject() {
  return { version: 1, width: 1280, height: 720, fps: 30, clips: [], texts: [], nextId: 1 };
}

export const clipDuration = (c) => (c.end - c.start) / c.speed;
export const totalDuration = (p) => p.clips.reduce((s, c) => s + clipDuration(c), 0);

export function findClip(p, id) {
  const c = p.clips.find((c) => c.id === id);
  if (!c) throw new Error(`No clip "${id}". Existing: ${p.clips.map((c) => c.id).join(', ') || '(none)'}`);
  return c;
}

export function addClip(p, { src, start, end, probe, index }) {
  if (!(end > start)) throw new Error('end must be greater than start');
  if (start < 0 || end > probe.duration + 0.05) throw new Error(`range outside source (0..${probe.duration.toFixed(2)}s)`);
  const clip = {
    id: `c${p.nextId++}`, src, start, end: Math.min(end, probe.duration), speed: 1, volume: 1,
    hasAudio: probe.hasAudio, fadeIn: 0, fadeOut: 0,
  };
  if (p.clips.length === 0) { p.width = probe.width || p.width; p.height = probe.height || p.height; }
  p.clips.splice(index ?? p.clips.length, 0, clip);
  return clip;
}

// Split a clip at a source-time position. Returns [left, right].
export function splitClip(p, id, at) {
  const c = findClip(p, id);
  if (!(at > c.start + 0.01 && at < c.end - 0.01)) throw new Error(`split point must be inside (${c.start}, ${c.end}) source seconds`);
  const right = { ...c, id: `c${p.nextId++}`, start: at, fadeIn: 0 };
  c.end = at; c.fadeOut = 0;
  p.clips.splice(p.clips.indexOf(c) + 1, 0, right);
  return [c, right];
}

// Delete a span of OUTPUT time, rippling later clips earlier.
export function removeRange(p, from, to) {
  if (!(to > from)) throw new Error('to must be greater than from');
  const out = [];
  let t = 0;
  for (const c of p.clips) {
    const d = clipDuration(c), a = t, b = t + d;
    t = b;
    if (b <= from || a >= to) { out.push(c); continue; }
    const keepLeft = from > a, keepRight = to < b;
    const toSrc = (x) => c.start + (x - a) * c.speed;
    if (keepLeft) out.push({ ...c, end: toSrc(from), fadeOut: 0 });
    if (keepRight) out.push({ ...c, id: keepLeft ? `c${p.nextId++}` : c.id, start: toSrc(to), fadeIn: 0 });
  }
  const removed = to - from;
  p.clips = out.filter((c) => c.end - c.start > 0.02);
  // keep overlays aligned: shift texts after the cut, drop texts fully inside it
  p.texts = p.texts
    .map((x) => {
      const s = x.start >= to ? x.start - removed : Math.min(x.start, from);
      const e = x.end >= to ? x.end - removed : Math.min(x.end, from);
      return { ...x, start: s, end: e };
    })
    .filter((x) => x.end - x.start > 0.05);
  return removed;
}

export function addText(p, t) {
  const total = totalDuration(p);
  if (!(t.end > t.start)) throw new Error('end must be greater than start');
  const text = { id: `t${p.nextId++}`, position: 'bottom', size: 44, ...t, end: Math.min(t.end, total) };
  p.texts.push(text);
  return text;
}

export function save(p, file) { fs.writeFileSync(file, JSON.stringify(p, null, 2)); }
export function load(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// Compact, model-friendly description of the timeline.
export function describe(p) {
  let t = 0;
  const clips = p.clips.map((c, i) => {
    const d = clipDuration(c);
    const row = {
      id: c.id, index: i, src: c.src, src_range: [+c.start.toFixed(2), +c.end.toFixed(2)],
      timeline_range: [+t.toFixed(2), +(t + d).toFixed(2)], speed: c.speed, volume: c.volume,
    };
    if (c.fadeIn) row.fadeIn = c.fadeIn;
    if (c.fadeOut) row.fadeOut = c.fadeOut;
    t += d;
    return row;
  });
  return { resolution: `${p.width}x${p.height}`, total_duration: +t.toFixed(2), clips, texts: p.texts };
}
