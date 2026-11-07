// Whole-timeline operations shared by the agent tools, weave-tool (the review room) and the Studio UI.
import * as T from './timeline.js';
import * as F from './ffmpeg.js';

// Map a SOURCE time span of clip i onto the timeline. Returns null if it doesn't overlap the clip.
function toTimeline(c, pos, s, e) {
  const a = Math.max(s, c.start), b = Math.min(e, c.end);
  if (b <= a) return null;
  return { from: pos.start + (a - c.start) / c.speed, to: pos.start + (b - c.start) / c.speed };
}

/**
 * Cut every silence longer than `minDuration` from every clip, keeping `pad` seconds of air
 * on each side so speech isn't clipped. Ripples the timeline. Returns what was removed.
 */
export async function removeSilences(project, { noiseDb = -35, minDuration = 0.6, pad = 0.15 } = {}, { detect = F.detectSilence, probe = F.probe } = {}) {
  const pos = T.positions(project);
  const ranges = [];
  const bySource = new Map();
  for (const [i, c] of project.clips.entries()) {
    if (!c.hasAudio) continue;
    if (!bySource.has(c.src)) {
      const info = await probe(c.src);
      bySource.set(c.src, (await detect(c.src, noiseDb, Math.max(0.2, minDuration))).map((x) => ({ start: x.start, end: x.end ?? info.duration })));
    }
    // Leave room for the transition overlap at the head of the clip.
    const headGuard = pos[i].trans;
    for (const s of bySource.get(c.src)) {
      const atEnd = s.end >= c.end - 0.01, atStart = s.start <= c.start + 0.01;
      const a = atStart ? s.start : s.start + pad, b = atEnd ? s.end : s.end - pad;
      if (b - a < Math.max(0.1, minDuration - 2 * pad)) continue;
      const r = toTimeline(c, pos[i], a, b);
      if (!r) continue;
      r.from = Math.max(r.from, pos[i].start + headGuard);
      if (r.to - r.from > 0.05) ranges.push(r);
    }
  }
  ranges.sort((x, y) => y.from - x.from);
  const before = T.totalDuration(project);
  for (const r of ranges) T.removeRange(project, r.from, r.to);
  return { removed_spans: ranges.length, removed_seconds: +(before - T.totalDuration(project)).toFixed(2), new_duration: +T.totalDuration(project).toFixed(2) };
}

// Split a transcript segment into short caption chunks, spreading its time across the words.
export function chunkSegment(seg, maxWords = 6) {
  const words = seg.text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const n = Math.ceil(words.length / maxWords);
  const per = Math.ceil(words.length / n);
  const out = [];
  for (let k = 0; k < words.length; k += per) {
    const w = words.slice(k, k + per);
    const s = seg.start + ((seg.end - seg.start) * k) / words.length;
    const e = seg.start + ((seg.end - seg.start) * Math.min(words.length, k + per)) / words.length;
    out.push({ start: s, end: e, text: w.join(' ') });
  }
  return out;
}

/**
 * Generate captions from speech for everything on the timeline (replacing earlier auto captions).
 * style: 'clean' (white, outlined), 'bold' (big yellow, CapCut-style), 'boxed' (white on dark box).
 */
export async function autoCaptions(project, { style = 'clean', maxWords = 6, position = 'bottom' } = {}, { transcribe = F.transcribe } = {}) {
  const STYLES = {
    clean: { size: 54, color: '#ffffff', box: false, style: 'bold' },
    bold: { size: 72, color: '#ffd400', box: false, style: 'bold' },
    boxed: { size: 50, color: '#ffffff', box: true, style: 'regular' },
  };
  const look = STYLES[style] || STYLES.clean;
  const pos = T.positions(project);
  const transcripts = new Map();
  const captions = [];
  for (const [i, c] of project.clips.entries()) {
    if (!c.hasAudio || c.volume === 0) continue;
    if (!transcripts.has(c.src)) transcripts.set(c.src, await transcribe(c.src));
    for (const seg of transcripts.get(c.src)) {
      for (const ch of chunkSegment(seg, maxWords)) {
        const r = toTimeline(c, pos[i], ch.start, ch.end);
        if (!r || r.to - r.from < 0.15) continue;
        // During a transition only the incoming clip's speech is kept.
        if (i + 1 < pos.length && r.from >= pos[i + 1].start) continue;
        captions.push({ start: r.from, end: r.to, text: ch.text });
      }
    }
  }
  captions.sort((a, b) => a.start - b.start);
  // No overlaps: each caption ends where the next begins.
  for (let k = 0; k + 1 < captions.length; k++) captions[k].end = Math.min(captions[k].end, captions[k + 1].start);
  project.texts = project.texts.filter((t) => !t.auto);
  for (const cap of captions) {
    if (cap.end - cap.start < 0.1) continue;
    project.texts.push({ id: `t${project.nextId++}`, auto: true, position, ...look, start: +cap.start.toFixed(3), end: +cap.end.toFixed(3), text: cap.text });
  }
  return { captions: project.texts.filter((t) => t.auto).length, style };
}
