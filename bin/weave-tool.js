#!/usr/bin/env node
// Weave's editing tools as a command, for agents that bring their own model
// (the crew in the room). Needs no API key.
//
//   npm run tool -- list
//   npm run tool -- remove_range '{"from":28.1,"to":37.7}'
//   npm run tool -- preview                  renders the next version: exports/v2.mp4
//   npm run tool -- restore '{"version":1}'  puts an earlier version's timeline back
//   npm run tool -- final                    renders exports/final.mp4 at full quality
//
// The timeline is weave.project.json in the current folder, the file Weave Studio opens.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { newProject, load, save } from '../src/timeline.js';
import { toolDefs, createToolbox } from '../src/tools.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // Switch's default AGENT_MEDIA_MAX_BYTES
const MAX_VERSIONS = 12; // Hard stop: Switch has no limit on agents addressing each other.
const PROJECT = path.resolve('weave.project.json');
const EXPORTS = path.resolve('exports');
const snapshot = (n) => path.join(EXPORTS, `v${n}.json`);

const fail = (message) => { console.error(message); process.exit(1); };

// Switch caps attachments, so a final over the cap also gets a copy that fits. The full one stays.
function fileForChat(file, duration) {
  if (fs.statSync(file).size <= MAX_ATTACHMENT_BYTES) return file;
  const kbps = Math.floor((MAX_ATTACHMENT_BYTES * 8 * 0.85) / duration / 1000) - 160;
  const small = file.replace(/\.mp4$/, '-chat.mp4');
  // -maxrate and -bufsize make it a limit. -b:v alone is only an average, and overshoots on hard footage.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-c:v', 'libx264', '-b:v', `${kbps}k`,
    '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', small]);
  return small;
}

const [name, arg = '{}'] = process.argv.slice(2);
if (!name) fail('Usage: weave-tool <tool> [json input]. Run "list" to see the tools.');

if (name === 'list') {
  for (const t of toolDefs) console.log(`${t.name}(${Object.keys(t.input_schema.properties).join(', ')}): ${t.description}`);
  console.log('preview(): Render the next version to exports/vN.mp4 for the room.');
  console.log('restore(version): Put the timeline of an earlier version back.');
  console.log('final(): Render exports/final.mp4 at full quality and name the file to post in chat.');
  process.exit(0);
}

let input;
try { input = JSON.parse(arg); } catch { fail(`The input is not valid JSON: ${arg}`); }

if (name === 'restore') {
  if (!fs.existsSync(snapshot(input.version))) fail(`There is no version ${input.version}.`);
  fs.copyFileSync(snapshot(input.version), PROJECT);
  console.log(`RESTORED v${input.version}`);
  process.exit(0);
}

const project = fs.existsSync(PROJECT) ? load(PROJECT) : newProject();
const before = JSON.stringify(project);
const call = createToolbox(project, { exportsDir: EXPORTS });

async function run(tool, toolInput) {
  const { content, is_error } = await call(tool, toolInput);
  if (is_error) fail(content);
  return content;
}

if (name === 'preview') {
  const done = fs.existsSync(EXPORTS) ? fs.readdirSync(EXPORTS).filter((f) => /^v\d+\.json$/.test(f)).length : 0;
  if (done && JSON.stringify(load(snapshot(done))) === before) {
    console.log(`NO CHANGE: the timeline is the same as v${done}.`);
    process.exit(0);
  }
  if (done >= MAX_VERSIONS) {
    console.log(`STOP: ${MAX_VERSIONS} versions reached. Ask a person how to continue.`);
    process.exit(0);
  }
  const version = done + 1;
  const output = path.join(EXPORTS, `v${version}.mp4`);
  const { duration, resolution, bytes } = JSON.parse(await run('render', { output, preview: true }));
  if (bytes > MAX_ATTACHMENT_BYTES) fail(`v${version} is ${bytes} bytes, over Switch's ${MAX_ATTACHMENT_BYTES}-byte attachment limit.`);
  save(project, snapshot(version));
  console.log(`PREVIEW v${version} ${output} ${duration}s ${resolution} ${bytes} bytes`);
  process.exit(0);
}

if (name === 'final') {
  const output = path.join(EXPORTS, 'final.mp4');
  const { duration, resolution } = JSON.parse(await run('render', { output, preview: false }));
  const post = fileForChat(output, duration);
  console.log(`FINAL ${post} ${duration}s ${resolution} ${fs.statSync(post).size} bytes`);
  process.exit(0);
}

const content = await run(name, input);
if (typeof content === 'string') {
  console.log(content);
} else {
  // view_frames answers with images. An agent on its own model reads them as files.
  const frames = path.join(EXPORTS, 'frames');
  fs.mkdirSync(frames, { recursive: true });
  content.forEach((block, i) => {
    if (block.type !== 'image') return;
    const file = path.join(frames, `${path.basename(input.path ?? 'frame')}-${i}.jpg`);
    fs.writeFileSync(file, Buffer.from(block.source.data, 'base64'));
    console.log(`${content[i - 1].text}: ${file}`);
  });
}
if (JSON.stringify(project) !== before) save(project, PROJECT);
