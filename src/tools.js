// Tool definitions exposed to Claude, plus their implementations.
import path from 'node:path';
import * as T from './timeline.js';
import * as F from './ffmpeg.js';

const num = (description) => ({ type: 'number', description });
const str = (description) => ({ type: 'string', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const toolDefs = [
  { name: 'probe_media', description: 'Get duration, resolution, fps and audio presence of a media file.', input_schema: obj({ path: str('Media file path') }, ['path']) },
  { name: 'detect_silence', description: 'Find silent spans (source seconds) in a file. Useful for cutting dead air / pauses.', input_schema: obj({ path: str('Media file path'), noise_db: num('Silence threshold in dB, default -35'), min_duration: num('Minimum silence length in seconds, default 0.5') }, ['path']) },
  { name: 'detect_scenes', description: 'Find scene-change timestamps (source seconds) in a file.', input_schema: obj({ path: str('Media file path'), threshold: num('0..1 sensitivity, default 0.3 (lower = more cuts)') }, ['path']) },
  { name: 'view_frames', description: 'Look at still frames from a source file (or the rendered timeline if path omitted and a preview exists). Returns images.', input_schema: obj({ path: str('Media file path'), times: { type: 'array', items: { type: 'number' }, description: 'Timestamps in seconds (max 8)' } }, ['path', 'times']) },
  { name: 'get_timeline', description: 'Return the current timeline: clips in order (with source and timeline ranges) and text overlays.', input_schema: obj({}) },
  { name: 'add_clip', description: 'Append (or insert at index) a range of a source file to the timeline.', input_schema: obj({ path: str('Source file'), start: num('Source start seconds'), end: num('Source end seconds'), index: num('Optional insert position') }, ['path', 'start', 'end']) },
  { name: 'trim_clip', description: 'Change the source in/out points of a clip.', input_schema: obj({ clip_id: str('Clip id'), start: num('New source start'), end: num('New source end') }, ['clip_id']) },
  { name: 'split_clip', description: 'Split a clip into two at a SOURCE time.', input_schema: obj({ clip_id: str('Clip id'), at: num('Source seconds') }, ['clip_id', 'at']) },
  { name: 'remove_range', description: 'Delete a span of TIMELINE (output) time across clips and ripple everything after it. Call get_timeline afterwards since later times shift.', input_schema: obj({ from: num('Timeline start seconds'), to: num('Timeline end seconds') }, ['from', 'to']) },
  { name: 'remove_ranges', description: 'Delete several TIMELINE spans at once (applied last-to-first so the given times stay valid). Ideal for removing all silences.', input_schema: obj({ ranges: { type: 'array', items: obj({ from: { type: 'number' }, to: { type: 'number' } }, ['from', 'to']) } }, ['ranges']) },
  { name: 'delete_clip', description: 'Remove a clip entirely.', input_schema: obj({ clip_id: str('Clip id') }, ['clip_id']) },
  { name: 'move_clip', description: 'Move a clip to a new index in the sequence.', input_schema: obj({ clip_id: str('Clip id'), index: num('New index') }, ['clip_id', 'index']) },
  { name: 'set_clip_props', description: 'Set speed (0.25-4), volume (0-4), fade_in / fade_out seconds on a clip.', input_schema: obj({ clip_id: str('Clip id'), speed: num('Playback speed'), volume: num('Volume multiplier'), fade_in: num('Fade in seconds'), fade_out: num('Fade out seconds') }, ['clip_id']) },
  { name: 'add_text', description: 'Add a caption/title overlay in TIMELINE time.', input_schema: obj({ text: str('Text'), start: num('Timeline start'), end: num('Timeline end'), position: { type: 'string', enum: ['top', 'center', 'bottom'] }, size: num('Font size in px at full resolution, default 44') }, ['text', 'start', 'end']) },
  { name: 'remove_text', description: 'Remove a text overlay by id.', input_schema: obj({ text_id: str('Text id') }, ['text_id']) },
  { name: 'render', description: 'Render the timeline to a video file. Use preview=true for a fast low-res check you can then inspect with view_frames.', input_schema: obj({ output: str('Output .mp4 path'), preview: { type: 'boolean' } }, ['output']) },
];

export function createToolbox(project, { cwd = process.cwd(), log = () => {} } = {}) {
  const abs = (p) => path.resolve(cwd, p);
  const probeCache = new Map();
  const probe = async (p) => { if (!probeCache.has(p)) probeCache.set(p, await F.probe(p)); return probeCache.get(p); };

  const handlers = {
    probe_media: ({ path: p }) => probe(abs(p)),
    detect_silence: async ({ path: p, noise_db, min_duration }) => {
      const file = abs(p), info = await probe(file);
      const s = await F.detectSilence(file, noise_db, min_duration);
      return { duration: info.duration, silences: s.map((x) => ({ ...x, end: x.end ?? info.duration })) };
    },
    detect_scenes: async ({ path: p, threshold }) => ({ cuts: await F.detectScenes(abs(p), threshold) }),
    view_frames: async ({ path: p, times }) => {
      const file = abs(p);
      const imgs = [];
      for (const t of times.slice(0, 8)) imgs.push({ t, data: await F.extractFrame(file, t) });
      return { __images: imgs };
    },
    get_timeline: () => T.describe(project),
    add_clip: async ({ path: p, start, end, index }) => {
      const file = abs(p);
      return T.describe(T.addClip(project, { src: file, start, end, index, probe: await probe(file) }) && project);
    },
    trim_clip: async ({ clip_id, start, end }) => {
      const c = T.findClip(project, clip_id), info = await probe(c.src);
      const s = start ?? c.start, e = end ?? c.end;
      if (!(e > s) || s < 0 || e > info.duration + 0.05) throw new Error(`invalid range; source is 0..${info.duration}`);
      c.start = s; c.end = Math.min(e, info.duration);
      return T.describe(project);
    },
    split_clip: ({ clip_id, at }) => { T.splitClip(project, clip_id, at); return T.describe(project); },
    remove_range: ({ from, to }) => { T.removeRange(project, from, to); return T.describe(project); },
    remove_ranges: ({ ranges }) => {
      [...ranges].sort((a, b) => b.from - a.from).forEach((r) => T.removeRange(project, r.from, r.to));
      return T.describe(project);
    },
    delete_clip: ({ clip_id }) => { project.clips.splice(project.clips.indexOf(T.findClip(project, clip_id)), 1); return T.describe(project); },
    move_clip: ({ clip_id, index }) => {
      const c = T.findClip(project, clip_id);
      project.clips.splice(project.clips.indexOf(c), 1);
      project.clips.splice(Math.max(0, Math.min(index, project.clips.length)), 0, c);
      return T.describe(project);
    },
    set_clip_props: ({ clip_id, speed, volume, fade_in, fade_out }) => {
      const c = T.findClip(project, clip_id);
      if (speed !== undefined) { if (speed < 0.25 || speed > 4) throw new Error('speed must be 0.25..4'); c.speed = speed; }
      if (volume !== undefined) c.volume = Math.max(0, Math.min(4, volume));
      if (fade_in !== undefined) c.fadeIn = Math.max(0, fade_in);
      if (fade_out !== undefined) c.fadeOut = Math.max(0, fade_out);
      return T.describe(project);
    },
    add_text: (t) => { T.addText(project, t); return T.describe(project); },
    remove_text: ({ text_id }) => {
      const i = project.texts.findIndex((t) => t.id === text_id);
      if (i < 0) throw new Error(`No text "${text_id}"`);
      project.texts.splice(i, 1);
      return T.describe(project);
    },
    render: async ({ output, preview }) => {
      let last = -1;
      return F.render(project, abs(output), {
        preview, onProgress: (f) => { const pct = Math.floor(f * 10) * 10; if (pct > last) { last = pct; log(`  rendering ${pct}%`); } },
      });
    },
  };

  // Returns content suitable for a tool_result block.
  return async function call(name, input) {
    const h = handlers[name];
    if (!h) return { content: `Unknown tool ${name}`, is_error: true };
    try {
      const r = await h(input || {});
      if (r && r.__images) {
        return { content: r.__images.flatMap(({ t, data }) => [{ type: 'text', text: `frame @ ${t}s` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }]) };
      }
      return { content: JSON.stringify(r) };
    } catch (e) {
      return { content: `Error: ${e.message}`, is_error: true };
    }
  };
}
