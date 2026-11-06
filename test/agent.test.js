// Agent loop against a scripted stand-in for the Anthropic Messages API (no key or network needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newProject } from '../src/timeline.js';
import { runAgent } from '../src/agent.js';

test('agent loop executes tool calls and feeds results back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-agent-'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'a.mp4')]);
  const script = [
    [{ type: 'tool_use', id: 't1', name: 'add_clip', input: { path: 'a.mp4' } }, { type: 'tool_use', id: 't2', name: 'set_project', input: { aspect: '9:16', fit: 'fill' } }],
    [{ type: 'tool_use', id: 't3', name: 'set_color', input: { clip_id: 'all', look: 'vivid' } }, { type: 'tool_use', id: 't4', name: 'split_clip', input: { clip_id: 'nope', at: 1 } }],
    [{ type: 'text', text: 'Done: vertical, vivid.' }],
  ];
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(init.headers['x-api-key'], 'test-key');
    const content = script[requests.length - 1];
    return new Response(JSON.stringify({ content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }));
  };
  try {
    const project = newProject();
    const events = [];
    let changes = 0;
    await runAgent({ instruction: 'make it vertical and vivid', project, cwd: dir, apiKey: 'test-key', onEvent: (e) => events.push(e), hooks: { onChange: () => changes++ } });
    assert.equal(project.clips.length, 1);
    assert.equal(project.height, 1920);
    assert.equal(project.clips[0].color.look, 'vivid');
    assert.ok(changes >= 3);
    // tool results (including the error) went back to the model
    const results = requests[2].messages.at(-1).content;
    assert.equal(results.length, 2);
    assert.ok(results[1].is_error && /No clip/.test(results[1].content));
    assert.ok(events.some((e) => e.type === 'tool_error'));
    assert.ok(events.some((e) => e.type === 'text' && /vertical/.test(e.text)));
    assert.equal(requests[0].tools.length > 20, true);
  } finally { globalThis.fetch = realFetch; }
});
