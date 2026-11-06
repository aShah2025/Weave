// End-to-end tests of the toolbox the agent drives (no API key needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newProject, removeRange, totalDuration, positions } from '../src/timeline.js';
import { createToolbox } from '../src/tools.js';
import { probe } from '../src/ffmpeg.js';

export const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-test-'));
const src = path.join(dir, 'src.mp4');
// 6s clip: tone 0-2s, silence 2-4s, tone 4-6s
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
  '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,4),0,0.5*sin(440*2*PI*t))':s=48000:d=6",
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'aac', path.join(dir, 'music.m4a')]);

const json = (r) => { assert.ok(!r.is_error, r.content); return JSON.parse(r.content); };
const clip = (id, start, end, extra = {}) => ({ id, src: 'x', start, end, speed: 1, volume: 1, hasAudio: true, fadeIn: 0, fadeOut: 0, transition: null, ...extra });

test('removeRange ripples, splits, and shifts overlays', () => {
  const p = newProject();
  p.clips.push(clip('c1', 0, 10));
  p.texts.push({ id: 't1', text: 'hi', start: 8, end: 9 });
  p.audio.push({ id: 'a1', at: 7 });
  removeRange(p, 2, 5);
  assert.equal(p.clips.length, 2);
  assert.equal(totalDuration(p), 7);
  assert.deepEqual([p.clips[1].start, p.clips[1].end], [5, 10]);
  assert.deepEqual([p.texts[0].start, p.texts[0].end], [5, 6]);
  assert.equal(p.audio[0].at, 4);
});

test('transitions overlap clips', () => {
  const p = newProject();
  p.clips.push(clip('c1', 0, 4), clip('c2', 0, 4, { transition: { type: 'fade', duration: 1 } }));
  assert.equal(totalDuration(p), 7);
  assert.deepEqual(positions(p).map((x) => x.start), [0, 3]);
});

test('agent toolbox: silence cut, transition, grade, music, caption, render', async () => {
  const p = newProject();
  const call = createToolbox(p, { cwd: dir });
  const { silences } = json(await call('detect_silence', { path: 'src.mp4' }));
  assert.equal(silences.length, 1);
  assert.ok(Math.abs(silences[0].start - 2) < 0.1 && Math.abs(silences[0].end - 4) < 0.1);

  json(await call('add_clip', { path: 'src.mp4' }));
  let tl = json(await call('remove_ranges', { ranges: silences.map((s) => ({ from: s.start + 0.15, to: s.end - 0.15 })) }));
  assert.equal(tl.clips.length, 2);
  json(await call('set_transition', { clip_id: 'all', type: 'wipeleft', duration: 0.4 }));
  json(await call('set_color', { clip_id: 'all', look: 'cinematic', saturation: 1.2, vignette: true }));
  json(await call('set_clip_props', { clip_id: tl.clips[1].id, speed: 1.5, fade_out: 0.3 }));
  json(await call('add_music', { path: 'music.m4a', volume: 0.3, duck: true, fade_out: 1 }));
  tl = json(await call('add_text', { text: 'Weave test', start: 0, end: 1.5, position: 'top', color: '#ffd400' }));
  assert.equal(tl.texts.length, 1);

  const frames = await call('view_frames', { path: 'src.mp4', times: [1] });
  assert.equal(frames.content[1].type, 'image');

  const r = json(await call('render', { output: 'out.mp4' }));
  const info = await probe(path.join(dir, 'out.mp4'));
  assert.ok(Math.abs(info.duration - r.duration) < 0.15, `rendered ${info.duration} vs expected ${r.duration}`);
  assert.ok(info.hasAudio && info.width === 640);

  json(await call('set_project', { aspect: '9:16', fit: 'fill' }));
  const v = json(await call('render', { output: 'vertical.mp4', preview: true }));
  const vi = await probe(path.join(dir, 'vertical.mp4'));
  assert.ok(vi.height > vi.width, 'vertical render');
  console.log('renders in', dir, r, v);
});

test('sandboxed toolbox refuses paths outside roots', async () => {
  const call = createToolbox(newProject(), { cwd: dir, roots: [dir] });
  const r = await call('probe_media', { path: '/etc/hosts' });
  assert.ok(r.is_error && /outside/.test(r.content));
});

test('bad tool input returns an error the model can read', async () => {
  const call = createToolbox(newProject(), { cwd: dir });
  const r = await call('split_clip', { clip_id: 'nope', at: 1 });
  assert.ok(r.is_error && /No clip/.test(r.content));
});
