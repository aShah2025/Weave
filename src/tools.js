// Tools exposed to Claude, plus their implementations. Every editing tool returns the new timeline
// so the model never works from stale times.
import path from 'node:path';
import fs from 'node:fs';
import * as T from './timeline.js';
import * as F from './ffmpeg.js';

const num = (description) => ({ type: 'number', description });
const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const clipId = str('Clip id, e.g. "c3"');

export const toolDefs = [
  { name: 'list_media', description: 'List files in the media library (imported footage, music, images) with duration and resolution.', input_schema: obj({}) },
  { name: 'probe_media', description: 'Get duration, resolution, fps and audio presence of a media file.', input_schema: obj({ path: str('Media file path') }, ['path']) },
  { name: 'detect_silence', description: 'Find silent spans (source seconds) in a file. Useful for cutting dead air / pauses.', input_schema: obj({ path: str('Media file path'), noise_db: num('Silence threshold dB, default -35'), min_duration: num('Minimum silence seconds, default 0.5') }, ['path']) },
  { name: 'detect_scenes', description: 'Find scene-change timestamps (source seconds) in a file.', input_schema: obj({ path: str('Media file path'), threshold: num('0..1 sensitivity, default 0.3 (lower = more cuts)') }, ['path']) },
  { name: 'measure_loudness', description: 'Measure integrated loudness (LUFS) and true peak of a file, to level clip volumes.', input_schema: obj({ path: str('Media file path') }, ['path']) },
  { name: 'view_frames', description: 'Look at still frames from a source file. Returns images. Use to understand content, pick shots, and verify renders.', input_schema: obj({ path: str('Media file path (a source, or a rendered output)'), times: { type: 'array', items: { type: 'number' }, description: 'Timestamps in seconds (max 8)' } }, ['path', 'times']) },
  { name: 'get_timeline', description: 'Return the current timeline: video clips (source + timeline ranges, color, transitions), music track, and text overlays.', input_schema: obj({}) },
  { name: 'set_project', description: 'Project settings: aspect ratio preset (16:9, 9:16 for TikTok/Reels/Shorts, 1:1, 4:5, 21:9), fit (fit = letterbox, fill = crop to fill), fps, name, background color.', input_schema: obj({ aspect: { type: 'string', enum: Object.keys(T.ASPECTS) }, fit: { type: 'string', enum: ['fit', 'fill'] }, fps: num('Frames per second'), name: str('Project name'), background: str('#rrggbb letterbox color') }) },
  { name: 'add_clip', description: 'Append (or insert at index) a range of a source video/image to the main video track.', input_schema: obj({ path: str('Source file'), start: num('Source start seconds (default 0)'), end: num('Source end seconds (default end of file)'), index: num('Optional insert position') }, ['path']) },
  { name: 'trim_clip', description: 'Change the source in/out points of a clip.', input_schema: obj({ clip_id: clipId, start: num('New source start'), end: num('New source end') }, ['clip_id']) },
  { name: 'split_clip', description: 'Split a clip into two at a SOURCE time.', input_schema: obj({ clip_id: clipId, at: num('Source seconds') }, ['clip_id', 'at']) },
  { name: 'split_at', description: 'Split whichever clip is under a TIMELINE time (like the razor tool).', input_schema: obj({ time: num('Timeline seconds') }, ['time']) },
  { name: 'remove_range', description: 'Delete a span of TIMELINE time across clips and ripple everything after it.', input_schema: obj({ from: num('Timeline start'), to: num('Timeline end') }, ['from', 'to']) },
  { name: 'remove_ranges', description: 'Delete several TIMELINE spans at once (applied last-to-first so the given times stay valid). Ideal for removing all silences or filler.', input_schema: obj({ ranges: { type: 'array', items: obj({ from: { type: 'number' }, to: { type: 'number' } }, ['from', 'to']) } }, ['ranges']) },
  { name: 'delete_clip', description: 'Remove a clip entirely (ripple).', input_schema: obj({ clip_id: clipId }, ['clip_id']) },
  { name: 'move_clip', description: 'Move a clip to a new index in the sequence.', input_schema: obj({ clip_id: clipId, index: num('New index') }, ['clip_id', 'index']) },
  { name: 'duplicate_clip', description: 'Duplicate a clip right after itself.', input_schema: obj({ clip_id: clipId }, ['clip_id']) },
  { name: 'set_clip_props', description: 'Set speed (0.25-4), volume (0-4, 0 mutes), fade_in / fade_out seconds, flip (mirror horizontally).', input_schema: obj({ clip_id: clipId, speed: num('Playback speed'), volume: num('Volume multiplier'), fade_in: num('Fade in seconds'), fade_out: num('Fade out seconds'), flip: bool('Mirror horizontally') }, ['clip_id']) },
  { name: 'set_color', description: `Color-grade a clip (or all clips with clip_id "all"). look presets: ${T.LOOKS.join(', ')}. brightness -1..1 (0), contrast 0..2 (1), saturation 0..3 (1), gamma 0.1..3 (1), temperature 2000..12000K (6500 neutral; lower = warmer), sharpen 0..2, vignette bool.`, input_schema: obj({ clip_id: str('Clip id or "all"'), look: { type: 'string', enum: T.LOOKS }, brightness: { type: 'number' }, contrast: { type: 'number' }, saturation: { type: 'number' }, gamma: { type: 'number' }, temperature: { type: 'number' }, sharpen: { type: 'number' }, vignette: { type: 'boolean' } }, ['clip_id']) },
  { name: 'set_transition', description: `Set the transition INTO a clip from the previous one (or "all" for every cut). type: ${T.TRANSITIONS.join(', ')}, or "none". Overlaps the clips, so the timeline gets shorter.`, input_schema: obj({ clip_id: str('Clip id (not the first clip) or "all"'), type: { type: 'string', enum: [...T.TRANSITIONS, 'none'] }, duration: num('Seconds, default 0.5') }, ['clip_id', 'type']) },
  { name: 'add_music', description: 'Put an audio file (music, voice-over, SFX) on the audio track at a TIMELINE time. duck=true auto-lowers it under dialogue.', input_schema: obj({ path: str('Audio or video file'), at: num('Timeline start (default 0)'), start: num('Source start (default 0)'), end: num('Source end (default end of file)'), volume: num('Volume multiplier, default 0.35'), duck: bool('Duck under dialogue'), fade_in: num('Seconds'), fade_out: num('Seconds') }, ['path']) },
  { name: 'set_audio_props', description: 'Change an audio-track item: at, start, end, volume, duck, fade_in, fade_out.', input_schema: obj({ audio_id: str('Audio item id, e.g. "a4"'), at: num(''), start: num(''), end: num(''), volume: num(''), duck: bool(''), fade_in: num(''), fade_out: num('') }, ['audio_id']) },
  { name: 'delete_audio', description: 'Remove an audio-track item.', input_schema: obj({ audio_id: str('Audio item id') }, ['audio_id']) },
  { name: 'add_text', description: 'Add a caption/title overlay in TIMELINE time.', input_schema: obj({ text: str('Text (use \\n for line breaks)'), start: num('Timeline start'), end: num('Timeline end'), position: { type: 'string', enum: ['top', 'center', 'bottom'] }, size: num('Font px at full resolution, default 56'), color: str('#rrggbb, default white'), box: bool('Dark box behind text (default true); false = outlined text'), style: { type: 'string', enum: ['bold', 'regular', 'serif', 'mono'] } }, ['text', 'start', 'end']) },
  { name: 'update_text', description: 'Edit a text overlay (any add_text field).', input_schema: obj({ text_id: str('Text id'), text: str(''), start: num(''), end: num(''), position: { type: 'string', enum: ['top', 'center', 'bottom'] }, size: num(''), color: str(''), box: bool(''), style: { type: 'string', enum: ['bold', 'regular', 'serif', 'mono'] } }, ['text_id']) },
  { name: 'remove_text', description: 'Remove a text overlay by id.', input_schema: obj({ text_id: str('Text id') }, ['text_id']) },
  { name: 'render', description: 'Render the timeline. preview=true is a fast low-res check you can inspect with view_frames; otherwise full quality. Output defaults to exports/<name>.mp4.', input_schema: obj({ output: str('Output .mp4 path (optional)'), preview: bool('Fast low-res preview') }) },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * hooks:
 *   onChange(project)        – timeline mutated (UI live-sync, autosave)
 *   onMedia(path) -> media   – make sure a file is in the media library (proxies etc.)
 *   onRendered(result)       – a render finished (Switch posts it to chat)
 *   onProgress(label, frac)  – render progress
 */
export function createToolbox(project, { cwd = process.cwd(), exportsDir = path.join(cwd, 'exports'), log = () => {}, hooks = {}, roots = null } = {}) {
  // `roots` sandboxes file access (used for requests arriving from team chat).
  const inside = (f) => !roots || roots.some((r) => { const rel = path.relative(path.resolve(r), f); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); });
  const abs = (p) => {
    if (!p) throw new Error('path is required');
    const byName = project.media.find((m) => m.name === p || m.id === p);
    const f = byName ? byName.path : path.resolve(cwd, p);
    if (!byName && !inside(f)) throw new Error('That path is outside the studio folder');
    return f;
  };
  const changed = () => { hooks.onChange?.(project); return T.describe(project); };
  const media = async (p) => { await hooks.onMedia?.(p); return F.probe(p); };

  const handlers = {
    list_media: () => project.media.map((m) => ({ id: m.id, name: m.name, path: m.path, duration: m.duration, resolution: m.width ? `${m.width}x${m.height}` : null, hasAudio: m.hasAudio, kind: m.kind })),
    probe_media: ({ path: p }) => F.probe(abs(p)),
    detect_silence: async ({ path: p, noise_db, min_duration }) => {
      const file = abs(p), info = await F.probe(file);
      const s = await F.detectSilence(file, noise_db, min_duration);
      return { duration: info.duration, silences: s.map((x) => ({ ...x, end: x.end ?? info.duration })) };
    },
    detect_scenes: async ({ path: p, threshold }) => ({ cuts: await F.detectScenes(abs(p), threshold) }),
    measure_loudness: async ({ path: p }) => F.loudness(abs(p)),
    view_frames: async ({ path: p, times }) => {
      const file = abs(p);
      const imgs = [];
      for (const t of (times || []).slice(0, 8)) imgs.push({ t, data: await F.extractFrame(file, t) });
      return { __images: imgs };
    },
    get_timeline: () => T.describe(project),
    set_project: ({ aspect, fit, fps, name, background }) => {
      if (aspect) [project.width, project.height] = T.ASPECTS[aspect];
      if (fit) project.fit = fit;
      if (fps) project.fps = clamp(Math.round(fps), 12, 60);
      if (name) project.name = name;
      if (background) project.background = background;
      return changed();
    },
    add_clip: async ({ path: p, start, end, index }) => {
      const file = abs(p);
      T.addClip(project, { src: file, start, end, index, probe: await media(file) });
      return changed();
    },
    trim_clip: async ({ clip_id, start, end }) => {
      const c = T.findClip(project, clip_id), info = await F.probe(c.src);
      const s = start ?? c.start, e = end ?? c.end;
      if (!(e > s) || s < 0 || e > info.duration + 0.05) throw new Error(`invalid range; source is 0..${info.duration}`);
      c.start = s; c.end = Math.min(e, info.duration);
      return changed();
    },
    split_clip: ({ clip_id, at }) => { T.splitClip(project, clip_id, at); return changed(); },
    split_at: ({ time }) => { T.splitAt(project, time); return changed(); },
    remove_range: ({ from, to }) => { T.removeRange(project, from, to); return changed(); },
    remove_ranges: ({ ranges }) => {
      [...ranges].sort((a, b) => b.from - a.from).forEach((r) => { if (r.to > r.from) T.removeRange(project, r.from, r.to); });
      return changed();
    },
    delete_clip: ({ clip_id }) => { project.clips.splice(project.clips.indexOf(T.findClip(project, clip_id)), 1); if (project.clips[0]) project.clips[0].transition = null; return changed(); },
    move_clip: ({ clip_id, index }) => {
      const c = T.findClip(project, clip_id);
      project.clips.splice(project.clips.indexOf(c), 1);
      project.clips.splice(clamp(index, 0, project.clips.length), 0, c);
      if (project.clips[0]) project.clips[0].transition = null;
      return changed();
    },
    duplicate_clip: ({ clip_id }) => {
      const c = T.findClip(project, clip_id);
      project.clips.splice(project.clips.indexOf(c) + 1, 0, { ...structuredClone(c), id: `c${project.nextId++}`, transition: null });
      return changed();
    },
    set_clip_props: ({ clip_id, speed, volume, fade_in, fade_out, flip }) => {
      const c = T.findClip(project, clip_id);
      if (speed !== undefined) { if (speed < 0.25 || speed > 4) throw new Error('speed must be 0.25..4'); c.speed = speed; }
      if (volume !== undefined) c.volume = clamp(volume, 0, 4);
      if (fade_in !== undefined) c.fadeIn = Math.max(0, fade_in);
      if (fade_out !== undefined) c.fadeOut = Math.max(0, fade_out);
      if (flip !== undefined) c.flip = !!flip;
      return changed();
    },
    set_color: ({ clip_id, ...rest }) => {
      const targets = clip_id === 'all' ? project.clips : [T.findClip(project, clip_id)];
      const v = defined(rest);
      if (v.brightness !== undefined) v.brightness = clamp(v.brightness, -1, 1);
      if (v.contrast !== undefined) v.contrast = clamp(v.contrast, 0, 2);
      if (v.saturation !== undefined) v.saturation = clamp(v.saturation, 0, 3);
      if (v.gamma !== undefined) v.gamma = clamp(v.gamma, 0.1, 3);
      if (v.temperature !== undefined) v.temperature = clamp(v.temperature, 2000, 12000);
      if (v.sharpen !== undefined) v.sharpen = clamp(v.sharpen, 0, 2);
      for (const c of targets) c.color = { ...T.defaultColor(), ...c.color, ...v };
      return changed();
    },
    set_transition: ({ clip_id, type, duration = 0.5 }) => {
      const targets = clip_id === 'all' ? project.clips.slice(1) : [T.findClip(project, clip_id)];
      if (clip_id !== 'all' && project.clips.indexOf(targets[0]) === 0) throw new Error('The first clip has nothing to transition from');
      for (const c of targets) c.transition = type === 'none' ? null : { type, duration: clamp(duration, 0.1, 3) };
      return changed();
    },
    add_music: async ({ path: p, at, start, end, volume = 0.35, duck = false, fade_in = 0, fade_out = 0 }) => {
      const file = abs(p);
      const item = T.addAudio(project, { src: file, start, end, at, probe: await media(file), volume });
      Object.assign(item, { duck, fadeIn: fade_in, fadeOut: fade_out });
      return changed();
    },
    set_audio_props: ({ audio_id, fade_in, fade_out, ...rest }) => {
      const a = T.findAudio(project, audio_id);
      Object.assign(a, defined({ ...rest, fadeIn: fade_in, fadeOut: fade_out }));
      return changed();
    },
    delete_audio: ({ audio_id }) => { project.audio.splice(project.audio.indexOf(T.findAudio(project, audio_id)), 1); return changed(); },
    add_text: (t) => { T.addText(project, defined(t)); return changed(); },
    update_text: ({ text_id, ...rest }) => {
      const t = project.texts.find((t) => t.id === text_id);
      if (!t) throw new Error(`No text "${text_id}"`);
      Object.assign(t, defined(rest));
      return changed();
    },
    remove_text: ({ text_id }) => {
      const i = project.texts.findIndex((t) => t.id === text_id);
      if (i < 0) throw new Error(`No text "${text_id}"`);
      project.texts.splice(i, 1);
      return changed();
    },
    render: async ({ output, preview }) => {
      const slug = (project.name || 'weave').replace(/[^\w-]+/g, '-').toLowerCase() || 'weave';
      let out = output ? path.resolve(cwd, output) : path.join(exportsDir, `${slug}${preview ? '-preview' : ''}.mp4`);
      if (roots && !inside(out)) out = path.join(exportsDir, path.basename(out));
      if (!out.endsWith('.mp4')) out += '.mp4';
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let last = -1;
      const res = await F.render(project, out, {
        preview,
        onProgress: (f) => {
          hooks.onProgress?.(preview ? 'preview' : 'export', f);
          const pct = Math.floor(f * 10) * 10;
          if (pct > last) { last = pct; log(`  rendering ${pct}%`); }
        },
      });
      const result = { ...res, preview: !!preview, bytes: fs.statSync(out).size };
      await hooks.onRendered?.(result);
      return result;
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
