# weave

An agentic video editor. Describe the edit in plain English; Claude inspects your footage, edits a non-destructive timeline with tools, renders a preview, looks at frames to check its work, and renders the final cut with ffmpeg.

```bash
export ANTHROPIC_API_KEY=...
node bin/weave.js "cut all the dead air, speed up the intro 1.5x, add a title 'Episode 3' for the first 3 seconds" -i talk.mp4 -o edited.mp4
```

Interactive mode keeps the conversation and timeline so you can keep refining:

```bash
node bin/weave.js --chat -i a.mp4 -i b.mp4 -o final.mp4
```

The timeline is saved to `weave.project.json` after every run, so later runs pick up where the last left off. `--show` prints it.

## How it works

| File | Role |
| --- | --- |
| `src/agent.js` | Agent loop: calls the Claude Messages API with tools until the model stops. |
| `src/tools.js` | Tools the model can call: probe, silence/scene detection, frame viewing (returned as images), clip add/trim/split/move/delete, ripple delete, speed/volume/fades, text overlays, render. |
| `src/timeline.js` | JSON timeline model. Clip ranges are in source seconds; ripple cuts and text are in timeline seconds. |
| `src/ffmpeg.js` | Probing, analysis, and a single `filter_complex` render (trim → speed → scale/pad → fades → concat → overlays). |
| `scripts/text2png.swift` | Renders caption images via AppKit (used because many ffmpeg builds lack `drawtext`). macOS only. |

## Requirements

- Node 20+ (no npm dependencies)
- `ffmpeg` / `ffprobe` on PATH
- macOS for text overlays (Swift); everything else is cross-platform
- `ANTHROPIC_API_KEY`; set `WEAVE_MODEL` or `-m` to change the model (default `claude-sonnet-5-5`)

## Tests

```bash
npm test
```

Generates a synthetic clip, runs the same tool calls the agent makes (detect silence → ripple-cut → speed → caption → render) and checks the output. No API key needed.
