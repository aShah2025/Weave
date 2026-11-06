#!/usr/bin/env node
// weave                      → open Weave Studio (editor UI) for the current folder
// weave studio [dir]         → same, for a folder
// weave edit "<instruction>" -i clip.mp4 -o out.mp4   → headless AI edit
// weave switch --url … --registration-key …           → connect to Switch, then run the studio
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { newProject, load, save } from '../src/timeline.js';
import { runAgent, DEFAULT_MODEL } from '../src/agent.js';
import { startServer } from '../src/server.js';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: 'string', short: 'i', multiple: true, default: [] },
    output: { type: 'string', short: 'o', default: 'out.mp4' },
    project: { type: 'string', short: 'p', default: 'weave.project.json' },
    model: { type: 'string', short: 'm', default: DEFAULT_MODEL },
    port: { type: 'string', default: process.env.PORT || '4321' },
    host: { type: 'string', default: '127.0.0.1' },
    'no-open': { type: 'boolean', default: false },
    url: { type: 'string' },
    'registration-key': { type: 'string' },
    'agent-id': { type: 'string' },
    'agent-key': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const cmd = positionals[0] && ['studio', 'edit', 'switch', 'help'].includes(positionals[0]) ? positionals.shift() : positionals.length ? 'edit' : 'studio';

if (o.help || cmd === 'help') {
  console.log(`weave — agentic video editor

  weave [studio] [dir]            open Weave Studio in your browser (default: current folder)
  weave edit "<instruction>" -i clip.mp4 [-i more.mp4] [-o out.mp4]
                                  headless AI edit, renders the result
  weave switch --url <switch server> --registration-key <key>
                                  register Weave as a Switch agent (Slack/Discord/Teams) and start the studio

Options: --port 4321  --host 127.0.0.1  --no-open  -m <model>
Requires ffmpeg on PATH. The AI editor needs ANTHROPIC_API_KEY (or set it in Studio → Settings).`);
  process.exit(0);
}

async function studio(dir) {
  const { url, studio: st } = await startServer({ dir, port: Number(o.port), host: o.host });
  console.log(`\n  ▶ Weave Studio  ${url}\n    folder: ${st.dir}\n`);
  if (!o['no-open']) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  return st;
}

if (cmd === 'studio') {
  await studio(positionals[0] || process.cwd());
} else if (cmd === 'switch') {
  const st = await studio(positionals[0] || process.cwd());
  if (o.url) {
    try {
      await st.switch.configure({ url: o.url, registrationKey: o['registration-key'], agentId: o['agent-id'], apiKey: o['agent-key'] });
      console.log('  ✓ Switch configured — mention @weave in your channel.');
    } catch (e) { console.error(`  ✗ Switch: ${e.message}`); }
  } else if (!st.switch.status().configured) console.log('  Configure Switch in the Studio’s Switch tab, or pass --url and --registration-key.');
} else {
  const projFile = path.resolve(o.project);
  const project = fs.existsSync(projFile) ? load(projFile) : newProject();
  const fmt = (e) => {
    if (e.type === 'text') console.log(`\n${e.text}\n`);
    else if (e.type === 'tool') console.log(`→ ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`);
    else if (e.type === 'tool_error') console.log(`  ✗ ${e.error.slice(0, 200)}`);
    else if (e.type === 'log') console.log(e.text);
  };
  try {
    await runAgent({ instruction: positionals.join(' '), project, sources: o.input.map((f) => path.resolve(f)), output: o.output, model: o.model, cwd: process.cwd(), onEvent: fmt,
      context: 'Running headless from the CLI: when the edit is done, render the final (preview=false) to the requested output path.' });
    save(project, projFile);
    console.log(`Timeline saved to ${path.relative(process.cwd(), projFile)} (open it with: weave studio)`);
  } catch (e) {
    save(project, projFile);
    console.error(`\nweave: ${e.message}`);
    process.exit(1);
  }
}
