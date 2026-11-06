// Everything that touches ffmpeg: probing, analysis, proxies/thumbnails/waveforms, and the render graph.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipDuration, positions, totalDuration, defaultColor } from './timeline.js';

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(os.tmpdir(), 'weave-cache');
fs.mkdirSync(CACHE, { recursive: true });

// Keep ffmpeg to a sane number of threads so the editor stays responsive on 16 GB laptops.
const THREADS = String(Math.max(2, Math.min(8, os.cpus().length - 2)));

function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e6) err = err.slice(-1e6); onStderr?.(String(d)); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}:\n${err.slice(-1500)}`))));
  });
}

const probeCache = new Map();
export async function probe(file) {
  if (probeCache.has(file)) return probeCache.get(file);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate || '0/1').split('/').map(Number);
  let width = v?.width, height = v?.height;
  const rot = Math.abs(Number(v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  const isImage = !!v && ['png', 'mjpeg', 'webp', 'bmp', 'gif'].includes(v.codec_name) && !(parseFloat(j.format.duration) > 0.5);
  const info = {
    duration: isImage ? 5 : parseFloat(j.format.duration), width, height, isImage,
    fps: d ? +(n / d).toFixed(2) : undefined, hasVideo: !!v, hasAudio: !!a, videoCodec: v?.codec_name, audioCodec: a?.codec_name,
    size: Number(j.format.size || 0),
  };
  probeCache.set(file, info);
  return info;
}

export async function detectSilence(file, noiseDb = -35, minDur = 0.5) {
  const log = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-']);
  const out = [];
  let cur = null;
  for (const line of log.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = parseFloat(s[1]);
    if (e && cur !== null) { out.push({ start: +cur.toFixed(2), end: +parseFloat(e[1]).toFixed(2) }); cur = null; }
  }
  if (cur !== null) out.push({ start: +cur.toFixed(2), end: null });
  return out;
}

export async function detectScenes(file, threshold = 0.3) {
  const log = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  return [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => +parseFloat(m[1]).toFixed(2));
}

// Integrated loudness and peak, so the agent can level audio.
export async function loudness(file) {
  const log = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const I = log.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0];
  const peak = log.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0];
  return { integrated_lufs: I ? +I : null, true_peak_dbfs: peak ? +peak : null };
}

export async function extractFrame(file, time, maxWidth = 640) {
  const out = path.join(CACHE, `${crypto.randomUUID()}.jpg`);
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, time)), '-i', file, '-frames:v', '1', '-vf', `scale='min(${maxWidth},iw)':-2`, '-q:v', '4', out]);
  const b64 = fs.readFileSync(out).toString('base64');
  fs.unlinkSync(out);
  return b64;
}

const key = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
const fileKey = (file) => { const s = fs.statSync(file); return key(file, s.size, s.mtimeMs); };

// Low-res, all-intra-ish H.264 proxy for smooth scrubbing in the browser.
export async function makeProxy(file, info) {
  const out = path.join(CACHE, `proxy-${fileKey(file)}.mp4`);
  if (fs.existsSync(out)) return out;
  const tmp = out + '.part.mp4';
  const args = ['-y', '-v', 'error', '-threads', THREADS];
  if (info.isImage) args.push('-loop', '1', '-t', String(info.duration));
  args.push('-i', file);
  if (info.hasVideo) args.push('-vf', "scale='min(960,iw)':-2,fps=30", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-g', '15', '-pix_fmt', 'yuv420p');
  else args.push('-vn');
  if (info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2'); else args.push('-an');
  args.push('-movflags', '+faststart', tmp);
  await run('ffmpeg', args);
  fs.renameSync(tmp, out);
  return out;
}

// One JPEG sprite: `count` thumbnails side by side, for the timeline filmstrip.
export async function makeThumbs(file, info, count = 24) {
  const out = path.join(CACHE, `thumbs-${fileKey(file)}.jpg`);
  if (fs.existsSync(out) || !info.hasVideo) return info.hasVideo ? { path: out, count, w: 160, h: Math.round(160 * info.height / info.width / 2) * 2 } : null;
  const h = Math.round((160 * info.height) / info.width / 2) * 2;
  const rate = info.isImage ? 1 : count / Math.max(info.duration, 0.1);
  const pre = info.isImage ? ['-loop', '1', '-t', String(count)] : [];
  await run('ffmpeg', ['-y', '-v', 'error', ...pre, '-i', file, '-vf', `fps=${rate},scale=160:${h},tile=${count}x1`, '-frames:v', '1', '-q:v', '5', out]);
  return { path: out, count, w: 160, h };
}

// Waveform peaks (0..255) at `perSec` values per second.
export async function makePeaks(file, info, perSec = 50) {
  if (!info.hasAudio) return null;
  const out = path.join(CACHE, `peaks-${fileKey(file)}.json`);
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  const rate = 8000, win = rate / perSec;
  const pcm = await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-']);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('peak extraction failed'))));
  });
  const n = Math.floor(pcm.length / 2);
  const peaks = [];
  for (let i = 0; i < n; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(n, i + win); j++) { const v = Math.abs(pcm.readInt16LE(j * 2)); if (v > m) m = v; }
    peaks.push(Math.round((m / 32768) * 255));
  }
  const res = { perSec, data: peaks };
  fs.writeFileSync(out, JSON.stringify(res));
  return res;
}

const STYLE_FONTS = { bold: 'bold', regular: 'regular', serif: 'serif', mono: 'mono' };
let textBin;
async function textRenderer() {
  if (textBin) return textBin;
  const src = path.join(HERE, '..', 'scripts', 'text2png.swift');
  const bin = path.join(CACHE, `text2png-${fileKey(src)}`);
  if (!fs.existsSync(bin)) await run('swiftc', ['-O', src, '-o', bin]);
  return (textBin = bin);
}
async function textImage(t, scale, W) {
  const size = Math.max(8, Math.round(t.size * scale));
  const style = STYLE_FONTS[t.style] || 'bold';
  const k = key(t.text, size, W, t.color, t.box, style);
  const out = path.join(CACHE, `txt-${k}.png`);
  if (!fs.existsSync(out)) {
    if (process.platform !== 'darwin') throw new Error('Text overlays currently render via macOS AppKit');
    await run(await textRenderer(), [out, t.text, String(size), String(Math.round(W * 0.9)), t.color || '#ffffff', t.box === false ? '0' : '1', style]);
  }
  return out;
}

const f3 = (n) => Number(n).toFixed(3);
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

// Color pipeline for one clip -> ffmpeg filter fragments.
export function colorFilters(c) {
  const col = { ...defaultColor(), ...(c.color || {}) };
  const f = [];
  const LOOK = {
    cinematic: ['curves=preset=medium_contrast', 'colorbalance=rs=-0.05:bs=0.08:rh=0.08:bh=-0.05', 'eq=saturation=0.9'],
    warm: ['colortemperature=temperature=4800'],
    cool: ['colortemperature=temperature=8500'],
    vintage: ['curves=preset=vintage', 'eq=saturation=0.8'],
    bw: ['hue=s=0', 'eq=contrast=1.1'],
    vivid: ['eq=saturation=1.35:contrast=1.08'],
    faded: ['curves=all=0/0.08 1/0.92', 'eq=saturation=0.75'],
    teal_orange: ['colorbalance=rs=-0.1:gs=0.02:bs=0.12:rh=0.12:gh=0.03:bh=-0.1', 'eq=saturation=1.1'],
  };
  if (col.look && LOOK[col.look]) f.push(...LOOK[col.look]);
  if (col.brightness !== 0 || col.contrast !== 1 || col.saturation !== 1 || col.gamma !== 1)
    f.push(`eq=brightness=${col.brightness}:contrast=${col.contrast}:saturation=${col.saturation}:gamma=${col.gamma}`);
  if (col.temperature && col.temperature !== 6500) f.push(`colortemperature=temperature=${Math.round(col.temperature)}`);
  if (col.sharpen > 0) f.push(`unsharp=5:5:${(col.sharpen * 1.5).toFixed(2)}`);
  if (col.vignette) f.push('vignette=PI/5');
  return f;
}

/**
 * Render the whole project with one ffmpeg process.
 * Graph: per-clip trim → speed → color → scale/pad|crop → fades,
 *        then xfade/concat chain, music mix (with optional ducking), text overlays, loudness limiter.
 */
export async function render(project, output, { preview = false, quality = 'high', onProgress, signal } = {}) {
  if (!project.clips.length) throw new Error('Timeline is empty');
  const scale = preview ? Math.min(1, 640 / Math.max(project.width, project.height)) : 1;
  const W = Math.round((project.width * scale) / 2) * 2, H = Math.round((project.height * scale) / 2) * 2;
  const fps = project.fps;
  const inputs = [];
  const inIdx = (f, opts = []) => {
    const k = f + opts.join(' ');
    let i = inputs.findIndex((x) => x.k === k);
    if (i < 0) { inputs.push({ k, f, opts }); i = inputs.length - 1; }
    return i;
  };
  const filters = [];
  const pos = positions(project);
  const fit = project.fit === 'fill'
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${(project.background || '#000000').replace('#', '0x')}`;

  for (const [i, c] of project.clips.entries()) {
    const info = await probe(c.src);
    const n = info.isImage ? inIdx(c.src, ['-loop', '1', '-t', f3(c.end + 1)]) : inIdx(c.src);
    const d = clipDuration(c);
    const v = [`trim=start=${f3(c.start)}:end=${f3(c.end)}`, `setpts=(PTS-STARTPTS)/${c.speed}`];
    if (c.flip) v.push('hflip');
    v.push(...colorFilters(c), fit, 'setsar=1', `fps=${fps}`, 'format=yuv420p', 'settb=AVTB');
    if (c.fadeIn) v.push(`fade=t=in:st=0:d=${c.fadeIn}`);
    if (c.fadeOut) v.push(`fade=t=out:st=${f3(Math.max(0, d - c.fadeOut))}:d=${c.fadeOut}`);
    filters.push(`[${n}:v]${v.join(',')}[v${i}]`);
    let a;
    if (c.hasAudio && info.hasAudio && c.volume > 0) {
      a = `[${n}:a]atrim=start=${f3(c.start)}:end=${f3(c.end)},asetpts=PTS-STARTPTS`;
      if (c.speed !== 1) a += `,${atempoChain(c.speed)}`;
      a += `,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${c.volume}`;
      if (c.fadeIn) a += `,afade=t=in:st=0:d=${c.fadeIn}`;
      if (c.fadeOut) a += `,afade=t=out:st=${f3(Math.max(0, d - c.fadeOut))}:d=${c.fadeOut}`;
      a += `,apad=whole_dur=${f3(d)},atrim=duration=${f3(d)}`;
    } else {
      a = `anullsrc=r=48000:cl=stereo,atrim=duration=${f3(d)},aformat=sample_fmts=fltp:channel_layouts=stereo`;
    }
    filters.push(`${a}[a${i}]`);
  }

  // Join clips: xfade where a transition is set, concat otherwise.
  let vCur = 'v0', aCur = 'a0', end = clipDuration(project.clips[0]);
  for (let i = 1; i < project.clips.length; i++) {
    const t = pos[i].trans;
    if (t > 0.01) {
      const type = project.clips[i].transition.type === 'dissolve' ? 'dissolve' : project.clips[i].transition.type;
      filters.push(`[${vCur}][v${i}]xfade=transition=${type}:duration=${f3(t)}:offset=${f3(end - t)}[vx${i}]`);
      filters.push(`[${aCur}][a${i}]acrossfade=d=${f3(t)}[ax${i}]`);
    } else {
      filters.push(`[${vCur}][${aCur}][v${i}][a${i}]concat=n=2:v=1:a=1[vx${i}][ax${i}]`);
    }
    vCur = `vx${i}`; aCur = `ax${i}`;
    end = pos[i].end;
  }
  const total = totalDuration(project);

  // Music / voice-over track.
  if (project.audio.length) {
    const labels = [];
    for (const [k, m] of project.audio.entries()) {
      const n = inIdx(m.src);
      const len = Math.min(m.end - m.start, Math.max(0, total - m.at));
      if (len <= 0.05) continue;
      let f = `[${n}:a]atrim=start=${f3(m.start)}:end=${f3(m.start + len)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${m.volume}`;
      if (m.fadeIn) f += `,afade=t=in:st=0:d=${m.fadeIn}`;
      if (m.fadeOut) f += `,afade=t=out:st=${f3(Math.max(0, len - m.fadeOut))}:d=${m.fadeOut}`;
      const ms = Math.round(m.at * 1000);
      f += `,adelay=${ms}|${ms}`;
      filters.push(`${f}[m${k}]`);
      labels.push({ label: `m${k}`, duck: m.duck });
    }
    if (labels.length) {
      const ducked = labels.filter((l) => l.duck), plain = labels.filter((l) => !l.duck);
      let main = aCur;
      if (ducked.length) {
        // Duck music under dialogue: sidechain-compress music with the clip audio as the key.
        filters.push(`[${main}]asplit=2[dlg][key]`);
        const dm = ducked.length > 1 ? (filters.push(`${ducked.map((l) => `[${l.label}]`).join('')}amix=inputs=${ducked.length}:duration=longest:normalize=0[dmix]`), 'dmix') : ducked[0].label;
        filters.push(`[${dm}][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]`);
        plain.push({ label: 'ducked' });
        main = 'dlg';
      }
      filters.push(`[${main}]${plain.map((l) => `[${l.label}]`).join('')}amix=inputs=${plain.length + 1}:duration=first:normalize=0[amix]`);
      aCur = 'amix';
    }
  }
  filters.push(`[${aCur}]alimiter=limit=0.95:level=false[aout]`);

  // Text overlays (pre-rendered PNGs).
  const mediaCount = inputs.length;
  const pngs = [];
  for (const t of project.texts) pngs.push(await textImage(t, W / project.width, W));
  project.texts.forEach((t, i) => {
    const y = t.position === 'top' ? 'H*0.07' : t.position === 'center' ? '(H-h)/2' : 'H-h-H*0.08';
    const fade = `fade=t=in:st=${f3(t.start)}:d=0.2:alpha=1,fade=t=out:st=${f3(Math.max(t.start, t.end - 0.2))}:d=0.2:alpha=1`;
    filters.push(`[${mediaCount + i}:v]format=rgba,loop=loop=-1:size=1,setpts=N/${fps}/TB,trim=duration=${f3(t.end + 0.5)},${fade}[tx${i}]`);
    filters.push(`[${vCur}][tx${i}]overlay=x=(W-w)/2:y=${y}:shortest=0:eof_action=pass:enable='between(t,${f3(t.start)},${f3(t.end)})'[vt${i}]`);
    vCur = `vt${i}`;
  });
  filters.push(`[${vCur}]null[vout]`);

  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:2', '-threads', THREADS, '-filter_complex_threads', THREADS];
  for (const x of inputs) args.push(...x.opts, '-i', x.f);
  for (const png of pngs) args.push('-i', png);
  const crf = preview ? '30' : quality === 'max' ? '16' : quality === 'medium' ? '23' : '19';
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', f3(total),
    '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', preview ? '96k' : '192k', '-movflags', '+faststart', output);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    signal?.addEventListener('abort', () => p.kill('SIGKILL'));
    let err = '';
    p.stderr.on('data', (d) => {
      err += d; if (err.length > 2e6) err = err.slice(-1e6);
      const m = [...String(d).matchAll(/out_time_us=(\d+)/g)].pop();
      if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(signal?.aborted ? 'Render cancelled' : `ffmpeg render failed:\n${err.slice(-2000)}`))));
  });
  onProgress?.(1);
  return { output, duration: +total.toFixed(2), resolution: `${W}x${H}` };
}
