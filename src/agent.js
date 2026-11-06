// The agent loop: Claude plans the edit and calls tools until it is done.
import { toolDefs, createToolbox } from './tools.js';
import { describe } from './timeline.js';

const API = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = process.env.WEAVE_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are Weave, an agentic video editor. You edit a non-destructive timeline with tools, then render it.

Working method:
1. Inspect first: probe the sources, and use detect_silence / detect_scenes / view_frames to understand the content before cutting.
2. Build or modify the timeline. Remember: clip in/out points are SOURCE seconds; remove_range and text overlays use TIMELINE seconds. After ripple edits, call get_timeline because later times shift.
3. When removing silences, keep ~0.15s of padding at each edge so speech isn't clipped, and skip silences shorter than ~0.4s.
4. Render a preview (preview=true) and check a few frames with view_frames if visual correctness matters, then render the final output.
5. Finish with a short summary of what you changed and where the output is.
Be decisive: make reasonable creative choices instead of asking questions.`;

export async function runAgent({ instruction, project, sources = [], output = 'out.mp4', cwd, log = console.log, model = DEFAULT_MODEL, maxTurns = 40, apiKey = process.env.ANTHROPIC_API_KEY, history = [] }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const call = createToolbox(project, { cwd, log });
  const context = `Source files: ${sources.length ? sources.join(', ') : '(none given)'}\nRequested output: ${output}\nCurrent timeline: ${JSON.stringify(describe(project))}`;
  const messages = [...history, { role: 'user', content: `${context}\n\nInstruction: ${instruction}` }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 8000, system: SYSTEM, tools: toolDefs, messages }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const msg = await res.json();
    messages.push({ role: 'assistant', content: msg.content });

    for (const b of msg.content) if (b.type === 'text' && b.text.trim()) log(`\n${b.text.trim()}\n`);
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !uses.length) return { messages, project };

    const results = [];
    for (const u of uses) {
      log(`→ ${u.name} ${JSON.stringify(u.input).slice(0, 160)}`);
      const r = await call(u.name, u.input);
      if (r.is_error) log(`  ✗ ${String(r.content).slice(0, 200)}`);
      results.push({ type: 'tool_result', tool_use_id: u.id, ...r });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error(`Stopped after ${maxTurns} turns`);
}
