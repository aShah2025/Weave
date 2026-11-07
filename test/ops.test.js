// One-step timeline operations (silences, captions), clip transforms and loudness normalization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newProject, addClip, totalDuration, positions } from '../src/timeline.js';
import { removeSilences, autoCaptions, chunkSegment } from '../src/ops.js';
import { probe, render, transformFilters, loudness } from '../src/ffmpeg.js';
import { createToolbox } from '../src/tools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-ops-'));
const talk = path.join(dir, 'talk.mp4');
// tone 0-2, silence 2-4, tone 4-6, silence 6-7.5, tone 7.5-9
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=9',
  '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,4)+between(t,6,7.5),0,0.4*sin(440*2*PI*t))':s=48000:d=9",
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', talk]);

test('remove_silences cuts every pause but keeps air around speech', async () => {
  const p = newProject();
  addClip(p, { src: talk, probe: await probe(talk) });
  const r = await removeSilences(p, { minDuration: 0.6, pad: 0.15 });
  assert.equal(r.removed_spans, 2);
  // 2s + 1.5s of silence, minus 0.15s padding on each side of each pause
  assert.ok(Math.abs(r.removed_seconds - (3.5 - 0.6)) < 0.15, `removed ${r.removed_seconds}`);
  assert.equal(p.clips.length, 3);
  assert.ok(Math.abs(totalDuration(p) - r.new_duration) < 0.01);
});

test('captions are chunked, mapped onto the timeline, and replace earlier auto captions', async () => {
  const p = newProject();
  const info = await probe(talk);
  addClip(p, { src: talk, start: 1, end: 9, probe: info });
  p.clips[0].speed = 2; // timeline = (source - 1) / 2
  p.texts.push({ id: 't0', text: 'manual title', start: 0, end: 1 });
  const fake = async () => [
    { start: 0.2, end: 1.8, text: 'this segment starts before the clip' },
    { start: 4, end: 6, text: 'one two three four five six seven eight nine ten' },
  ];
  const r = await autoCaptions(p, { style: 'bold', maxWords: 5 }, { transcribe: fake });
  const auto = p.texts.filter((t) => t.auto);
  assert.equal(r.captions, auto.length);
  assert.ok(auto.length >= 3);
  const tens = auto.filter((t) => /one|six/.test(t.text));
  assert.deepEqual(tens.map((t) => t.text), ['one two three four five', 'six seven eight nine ten']);
  assert.ok(Math.abs(tens[0].start - 1.5) < 0.01 && Math.abs(tens[1].end - 2.5) < 0.01, JSON.stringify(tens));
  assert.equal(auto[0].color, '#ffd400');
  assert.ok(p.texts.some((t) => t.id === 't0'), 'manual text kept');
  for (let k = 0; k + 1 < auto.length; k++) assert.ok(auto[k].end <= auto[k + 1].start + 1e-9, 'no overlaps');
  await autoCaptions(p, {}, { transcribe: fake });
  assert.equal(p.texts.filter((t) => t.auto).length, auto.length, 'regenerating replaces, not duplicates');
});

test('chunkSegment spreads time across words', () => {
  const c = chunkSegment({ start: 0, end: 4, text: 'a b c d e f g h' }, 4);
  assert.deepEqual(c.map((x) => [x.start, x.end, x.text]), [[0, 2, 'a b c d'], [2, 4, 'e f g h']]);
});

test('transform filters punch in and pan within the frame', () => {
  assert.deepEqual(transformFilters({ zoom: 1, x: 0, y: 0, rotate: 0 }, 1920, 1080), []);
  const f = transformFilters({ zoom: 2, x: 1, y: -1, rotate: 0 }, 1920, 1080);
  assert.deepEqual(f, ['scale=3840:2160', 'crop=1920:1080:1920:0']);
});

test('zoomed + rotated clip renders, and normalize lands near -14 LUFS', async () => {
  const p = newProject();
  addClip(p, { src: talk, start: 0, end: 2, probe: await probe(talk) });
  p.clips[0].transform = { zoom: 1.5, x: 0.5, y: 0, rotate: 5 };
  p.normalize = true;
  const out = path.join(dir, 'zoom.mp4');
  const r = await render(p, out, {});
  const info = await probe(out);
  assert.equal(info.width, 640);
  assert.ok(Math.abs(info.duration - r.duration) < 0.15);
  const { integrated_lufs } = await loudness(out);
  assert.ok(Math.abs(integrated_lufs + 14) < 1.2, `got ${integrated_lufs} LUFS`);
});

test('agent tools expose the new operations', async () => {
  const p = newProject();
  const call = createToolbox(p, { cwd: dir });
  JSON.parse((await call('add_clip', { path: 'talk.mp4' })).content);
  const t = JSON.parse((await call('set_transform', { clip_id: 'all', zoom: 9, x: -3 })).content);
  assert.deepEqual(t.clips[0].transform, { zoom: 4, x: -1, y: 0, rotate: 0 });
  const s = JSON.parse((await call('remove_silences', {})).content);
  assert.equal(s.removed_spans, 2);
  assert.ok(positions(p).length === 3);
  const sp = JSON.parse((await call('set_project', { normalize_audio: true })).content);
  assert.equal(sp.normalize_audio, true);
});
