// The agent loop: Claude plans the edit and calls tools until it is done.
import { toolDefs, createToolbox } from './tools.js';
import { describe } from './timeline.js';

const API = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = process.env.WEAVE_MODEL || 'claude-opus-5-5';

const SYSTEM = `You are Weave, an expert AI video editor working inside a non-linear editor (think CapCut / DaVinci Resolve).
You edit a non-destructive timeline with tools; the human sees every change live in the editor and can undo it.

Timeline model:
- Main video track: clips play back to back. Clip in/out points are SOURCE seconds.
- remove_range, split_at, text overlays and the audio track use TIMELINE seconds. Ripple edits shift later times, and every editing tool returns the fresh timeline — always use the latest one.
- Transitions overlap neighbouring clips, so they shorten the timeline.

How to work:
1. Inspect first: list_media / probe the sources; use detect_silence, detect_scenes, measure_loudness and view_frames to understand content before cutting.
2. Make the edit. Good defaults: when removing silences keep ~0.15s padding on each side and skip gaps < 0.4s; music at ~0.25-0.35 volume with duck=true under speech; short 0.3-0.6s transitions; captions on the bottom; titles centered; vertical (9:16, fill) for TikTok/Reels/Shorts.
3. When visual correctness matters, render a preview (preview=true) and check frames from the OUTPUT with view_frames.
4. Only render the final (preview=false) when the user asks for an export / final / render, or when running headless with an output requested.
5. Finish with a brief summary (what changed, final duration, where the file is). Be decisive — make tasteful creative choices instead of asking questions.`;

// Old frame images are expensive to resend; keep only the most recent batch.
function pruneImages(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue;
      if (block.content.some((b) => b.type === 'image')) {
        if (seen++ >= 1) block.content = block.content.map((b) => (b.type === 'image' ? { type: 'text', text: '[earlier frame omitted]' } : b));
      }
    }
  }
}

/**
 * onEvent receives {type: 'text'|'tool'|'tool_result'|'tool_error'|'done'|'error', ...}
 * Returns { messages } so callers can keep the conversation going.
 */
export async function runAgent({
  instruction, project, sources = [], output, cwd, exportsDir, hooks = {}, onEvent = () => {},
  model = DEFAULT_MODEL, maxTurns = 50, apiKey = process.env.ANTHROPIC_API_KEY, history = [], signal, context: extra = '', roots = null,
}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (add it in Settings or your environment)');
  const log = (text) => onEvent({ type: 'log', text });
  const call = createToolbox(project, { cwd, exportsDir, log, hooks, roots });
  const context = [
    sources.length ? `Source files: ${sources.join(', ')}` : '',
    project.media.length ? `Media library: ${project.media.map((m) => `${m.name} (${m.path}, ${m.duration?.toFixed?.(1)}s${m.hasVideo === false ? ', audio' : ''})`).join('; ')}` : '',
    output ? `Requested output: ${output}` : '',
    `Current timeline: ${JSON.stringify(describe(project))}`,
    extra,
  ].filter(Boolean).join('\n');
  const messages = [...history, { role: 'user', content: `${context}\n\nInstruction: ${instruction}` }];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) throw new Error('Stopped');
    pruneImages(messages);
    const res = await fetch(API, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: toolDefs, messages,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const msg = await res.json();
    messages.push({ role: 'assistant', content: msg.content });

    for (const b of msg.content) if (b.type === 'text' && b.text.trim()) onEvent({ type: 'text', text: b.text.trim() });
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !uses.length) { onEvent({ type: 'done' }); return { messages }; }

    const results = [];
    for (const u of uses) {
      if (signal?.aborted) throw new Error('Stopped');
      onEvent({ type: 'tool', name: u.name, input: u.input });
      const r = await call(u.name, u.input);
      if (r.is_error) onEvent({ type: 'tool_error', name: u.name, error: String(r.content) });
      results.push({ type: 'tool_result', tool_use_id: u.id, ...r });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error(`Stopped after ${maxTurns} turns`);
}
