import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipDuration, totalDuration } from './timeline.js';

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(os.tmpdir(), 'weave-cache');
fs.mkdirSync(CACHE, { recursive: true });

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}:\n${err.slice(-1500)}`))));
  });
}

export async function probe(file) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: parseFloat(j.format.duration), width: v?.width, height: v?.height,
    fps: d ? +(n / d).toFixed(2) : undefined, hasVideo: !!v, hasAudio: !!a, videoCodec: v?.codec_name, audioCodec: a?.codec_name,
  };
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
  if (cur !== null) out.push({ start: +cur.toFixed(2), end: null }); // runs to end of file
  return out;
}

export async function detectScenes(file, threshold = 0.3) {
  const log = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  return [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => +parseFloat(m[1]).toFixed(2));
}

export async function extractFrame(file, time, maxWidth = 640) {
  const out = path.join(CACHE, `${crypto.randomUUID()}.jpg`);
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `scale='min(${maxWidth},iw)':-2`, '-q:v', '4', out]);
  const b64 = fs.readFileSync(out).toString('base64');
  fs.unlinkSync(out);
  return b64;
}

async function textImage(text, size, width) {
  const key = crypto.createHash('sha1').update(`${text}|${size}|${width}`).digest('hex');
  const out = path.join(CACHE, `txt-${key}.png`);
  if (!fs.existsSync(out)) await run('swift', [path.join(HERE, '..', 'scripts', 'text2png.swift'), out, text, String(size), String(Math.round(width * 0.9))]);
  return out;
}

const fmt = (n) => n.toFixed(3);
// atempo only accepts 0.5..2 per instance, so chain.
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

export async function render(project, output, { preview = false, onProgress } = {}) {
  if (!project.clips.length) throw new Error('Timeline is empty');
  const W = preview ? 640 : project.width, H = preview ? Math.round((640 * project.height) / project.width / 2) * 2 : project.height;
  const fps = project.fps;
  const inputs = [];
  const inIdx = (f) => { let i = inputs.indexOf(f); if (i < 0) { inputs.push(f); i = inputs.length - 1; } return i; };
  const filters = [];
  const labels = [];

  project.clips.forEach((c, i) => {
    const n = inIdx(c.src), d = clipDuration(c);
    let v = `[${n}:v]trim=start=${fmt(c.start)}:end=${fmt(c.end)},setpts=(PTS-STARTPTS)/${c.speed},` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
    if (c.fadeIn) v += `,fade=t=in:st=0:d=${c.fadeIn}`;
    if (c.fadeOut) v += `,fade=t=out:st=${fmt(Math.max(0, d - c.fadeOut))}:d=${c.fadeOut}`;
    filters.push(`${v}[v${i}]`);
    let a;
    if (c.hasAudio) {
      a = `[${n}:a]atrim=start=${fmt(c.start)}:end=${fmt(c.end)},asetpts=PTS-STARTPTS`;
      if (c.speed !== 1) a += `,${atempoChain(c.speed)}`;
      a += `,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${c.volume}`;
      if (c.fadeIn) a += `,afade=t=in:st=0:d=${c.fadeIn}`;
      if (c.fadeOut) a += `,afade=t=out:st=${fmt(Math.max(0, d - c.fadeOut))}:d=${c.fadeOut}`;
    } else {
      a = `anullsrc=r=48000:cl=stereo,atrim=duration=${fmt(d)}`;
    }
    filters.push(`${a}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  filters.push(`${labels.join('')}concat=n=${project.clips.length}:v=1:a=1[vcat][aout]`);

  let last = 'vcat';
  // text overlays are pre-rendered PNGs, appended as inputs after the media files
  const pngs = [];
  for (const t of project.texts) pngs.push(await textImage(t.text, Math.round(t.size * (W / project.width)), W));
  const mediaCount = inputs.length;
  project.texts.forEach((t, i) => {
    const k = mediaCount + i;
    const y = t.position === 'top' ? 'H*0.06' : t.position === 'center' ? '(H-h)/2' : 'H-h-H*0.06';
    filters.push(`[${last}][${k}:v]overlay=x=(W-w)/2:y=${y}:enable='between(t,${fmt(t.start)},${fmt(t.end)})'[vt${i}]`);
    last = `vt${i}`;
  });

  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:2'];
  for (const f of inputs) args.push('-i', f);
  for (const png of pngs) args.push('-i', png);
  args.push('-filter_complex', filters.join(';'), '-map', `[${last}]`, '-map', '[aout]',
    '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'medium', '-crf', preview ? '30' : '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output);

  const total = totalDuration(project);
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
      const m = [...String(d).matchAll(/out_time_us=(\d+)/g)].pop();
      if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg render failed:\n${err.slice(-1500)}`))));
  });
  return { output, duration: +total.toFixed(2), resolution: `${W}x${H}` };
}
