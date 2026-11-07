// The command the review room's agents edit with. No API key, no Switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from '../src/ffmpeg.js';

const BIN = fileURLToPath(new URL('../bin/weave-tool.js', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-tool-'));
const src = path.join(dir, 'src.mp4');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);

const tool = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8' });
const ok = (...args) => {
  const r = tool(...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test('a note becomes numbered versions, and an unchanged cut is never posted as new', async () => {
  ok('add_clip', JSON.stringify({ path: src, start: 0, end: 6 }));

  const v1 = ok('preview');
  assert.match(v1, /^PREVIEW v1 /);
  assert.ok(Math.abs((await probe(path.join(dir, 'exports', 'v1.mp4'))).duration - 6) < 0.2);
  assert.match(ok('preview'), /^NO CHANGE/);

  ok('remove_range', JSON.stringify({ from: 2, to: 4 }));
  assert.match(ok('preview'), /^PREVIEW v2 /);
  assert.ok(Math.abs((await probe(path.join(dir, 'exports', 'v2.mp4'))).duration - 4) < 0.2);

  assert.match(ok('restore', '{"version":1}'), /^RESTORED v1/);
  assert.equal(JSON.parse(ok('get_timeline')).total_duration, 6);
  assert.match(ok('preview'), /^PREVIEW v3 /);
});

test('frames come back as files an agent can read', () => {
  const out = ok('view_frames', JSON.stringify({ path: src, times: [1] }));
  const file = out.split(': ')[1];
  assert.ok(fs.statSync(file).size > 0);
});

test('reading the timeline does not write it', () => {
  const project = path.join(dir, 'weave.project.json');
  const before = fs.statSync(project).mtimeMs;
  ok('get_timeline');
  assert.equal(fs.statSync(project).mtimeMs, before);
});

test('failures say what went wrong and exit non-zero', () => {
  assert.notEqual(tool('remove_range', 'not json').status, 0);
  const r = tool('delete_clip', '{"clip_id":"nope"}');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /nope/);
  assert.notEqual(tool('restore', '{"version":99}').status, 0);
});

test('a final too big for chat gets a copy that fits, and the full one stays', () => {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-final-'));
  const big = path.join(own, 'big.mp4');
  // Noise, because a clean test pattern compresses far below the cap at any setting.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=8,noise=alls=100:allf=t',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', big]);
  const run = (...args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: own, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  run('add_clip', JSON.stringify({ path: big }));
  assert.match(run('final'), /^FINAL .*final-chat\.mp4 /);
  const cap = 20 * 1024 * 1024;
  assert.ok(fs.statSync(path.join(own, 'exports', 'final.mp4')).size > cap, 'the full final has to start over the cap');
  assert.ok(fs.statSync(path.join(own, 'exports', 'final-chat.mp4')).size <= cap);
});

test('a final that fits is posted as it is', () => {
  const out = ok('final');
  assert.match(out, /^FINAL .*final\.mp4 /);
  assert.equal(fs.existsSync(path.join(dir, 'exports', 'final-chat.mp4')), false);
});

test('a review loop that never converges hits a hard stop', () => {
  for (let i = fs.readdirSync(path.join(dir, 'exports')).filter((f) => /^v\d+\.json$/.test(f)).length; i < 12; i++) {
    ok('remove_range', JSON.stringify({ from: 0, to: 0.02 }));
    assert.match(ok('preview'), /^PREVIEW /);
  }
  ok('remove_range', JSON.stringify({ from: 0, to: 0.02 }));
  assert.match(ok('preview'), /^STOP/);
});
