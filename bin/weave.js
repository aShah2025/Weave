#!/usr/bin/env node
// weave "cut the silences and add a title" -i talk.mp4 -o edited.mp4
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { newProject, load, save, describe } from '../src/timeline.js';
import { runAgent, DEFAULT_MODEL } from '../src/agent.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: 'string', short: 'i', multiple: true, default: [] },
    output: { type: 'string', short: 'o', default: 'out.mp4' },
    project: { type: 'string', short: 'p', default: 'weave.project.json' },
    model: { type: 'string', short: 'm', default: DEFAULT_MODEL },
    chat: { type: 'boolean', short: 'c', default: false },
    show: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || (!positionals.length && !values.chat && !values.show)) {
  console.log(`weave — agentic video editor

Usage:
  weave "<instruction>" -i clip.mp4 [-i more.mp4] [-o out.mp4]
  weave --chat -i clip.mp4          interactive: keep refining the edit
  weave --show                      print the saved timeline

Options:
  -i, --input    source media (repeatable)
  -o, --output   output file (default out.mp4)
  -p, --project  timeline file, persisted between runs (default weave.project.json)
  -m, --model    Claude model (default ${DEFAULT_MODEL})

Requires ANTHROPIC_API_KEY and ffmpeg on PATH.`);
  process.exit(0);
}

const projFile = path.resolve(values.project);
const project = fs.existsSync(projFile) ? load(projFile) : newProject();
if (values.show) { console.log(JSON.stringify(describe(project), null, 2)); process.exit(0); }

const opts = { project, sources: values.input, output: values.output, model: values.model, cwd: process.cwd() };
try {
  if (values.chat) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let history = [];
    let instruction = positionals.join(' ');
    for (;;) {
      if (!instruction) instruction = (await rl.question('\nweave> ')).trim();
      if (!instruction || ['exit', 'quit'].includes(instruction)) break;
      ({ messages: history } = await runAgent({ ...opts, instruction, history }));
      save(project, projFile);
      instruction = '';
    }
    rl.close();
  } else {
    await runAgent({ ...opts, instruction: positionals.join(' ') });
    save(project, projFile);
  }
  console.log(`Timeline saved to ${path.relative(process.cwd(), projFile)}`);
} catch (e) {
  save(project, projFile);
  console.error(`\nweave: ${e.message}`);
  process.exit(1);
}
