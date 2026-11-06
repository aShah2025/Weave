// Inspector: properties for the selected clip / text / audio item, or project settings.
import { S, $, h, on, emit, commit, begin, save, selected, mediaFor, defaultColor, clipDur, positions, total, tc, dur } from './store.js';

const root = $('#inspector');

// Slider row: live preview while dragging (one undo step per gesture).
function slider(label, value, { min, max, step = 0.01, fmt = (v) => (+v).toFixed(2), set }) {
  const val = h('input', { class: 'val', value: fmt(value) });
  const rng = h('input', { type: 'range', min, max, step, value });
  let began = false;
  const apply = (v) => { if (!began) { begin(); began = true; } set(+v); emit('change', { from: 'inspector' }); };
  rng.addEventListener('input', () => { apply(rng.value); val.value = fmt(rng.value); });
  rng.addEventListener('change', () => { began = false; save(); emit('change', { from: 'inspector-done' }); });
  rng.addEventListener('dblclick', () => { /* reset handled by caller via default */ });
  val.addEventListener('change', () => { const v = parseFloat(val.value); if (!Number.isNaN(v)) { apply(Math.min(max, Math.max(min, v))); began = false; rng.value = v; save(); emit('change', { from: 'inspector-done' }); } });
  return h('div', { class: 'row' }, h('label', {}, label), rng, val);
}
function toggle(label, on, set) {
  const b = h('button', { class: `switchbox ${on ? 'on' : ''}`, onclick: () => { commit(() => set(!on), { silentInspector: false }); } });
  return h('div', { class: 'row wide' }, h('label', {}, label), h('div', {}, b));
}
function seg(label, options, value, set) {
  return h('div', { class: 'row wide' }, h('label', {}, label), h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { class: v === value ? 'on' : '', onclick: () => commit(() => set(v)) }, l))));
}
function select(label, options, value, set) {
  const s = h('select', { onchange: (e) => commit(() => set(e.target.value)) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return h('div', { class: 'row wide' }, h('label', {}, label), s);
}
const group = (title, rows, action) => h('div', { class: 'group' }, h('h4', {}, title, action || ''), h('div', { class: 'rows' }, rows));

function clipInspector(c) {
  const m = mediaFor(c.src);
  const i = S.project.clips.indexOf(c);
  const pos = positions()[i];
  const col = { ...defaultColor(), ...c.color };
  const setCol = (k) => (v) => { c.color = { ...defaultColor(), ...c.color, [k]: v }; };
  return [
    h('div', { class: 'insp-title' }, m?.name || 'Clip', h('span', { class: 'badge' }, c.id)),
    h('div', { class: 'muted small' }, `Timeline ${tc(pos.start)} → ${tc(pos.end)} · ${clipDur(c).toFixed(2)}s · source ${c.start.toFixed(2)}–${c.end.toFixed(2)}s`),
    group('Clip', [
      slider('Speed', c.speed, { min: 0.25, max: 4, step: 0.05, fmt: (v) => `${(+v).toFixed(2)}×`, set: (v) => (c.speed = v) }),
      slider('Volume', c.volume, { min: 0, max: 2, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, set: (v) => (c.volume = v) }),
      slider('Fade in', c.fadeIn, { min: 0, max: 3, step: 0.05, fmt: (v) => `${(+v).toFixed(2)}s`, set: (v) => (c.fadeIn = v) }),
      slider('Fade out', c.fadeOut, { min: 0, max: 3, step: 0.05, fmt: (v) => `${(+v).toFixed(2)}s`, set: (v) => (c.fadeOut = v) }),
      toggle('Mirror', c.flip, (v) => (c.flip = v)),
    ]),
    i > 0 ? group('Transition in', [
      select('Type', [['none', 'None (cut)'], ...S.transitions.map((t) => [t, t])], c.transition?.type || 'none', (v) => (c.transition = v === 'none' ? null : { type: v, duration: c.transition?.duration || 0.5 })),
      c.transition ? slider('Duration', c.transition.duration, { min: 0.1, max: 2, step: 0.05, fmt: (v) => `${(+v).toFixed(2)}s`, set: (v) => (c.transition.duration = v) }) : null,
    ]) : null,
    group('Color', [
      select('Look', S.looks.map((l) => [l, l === 'none' ? 'None' : l.replace('_', ' / ')]), col.look, setCol('look')),
      slider('Exposure', col.brightness, { min: -0.5, max: 0.5, step: 0.01, set: setCol('brightness') }),
      slider('Contrast', col.contrast, { min: 0.5, max: 1.8, step: 0.01, set: setCol('contrast') }),
      slider('Saturation', col.saturation, { min: 0, max: 2.5, step: 0.01, set: setCol('saturation') }),
      slider('Gamma', col.gamma, { min: 0.5, max: 2, step: 0.01, set: setCol('gamma') }),
      slider('Temperature', col.temperature, { min: 2500, max: 11000, step: 50, fmt: (v) => `${Math.round(v)}K`, set: setCol('temperature') }),
      slider('Sharpen', col.sharpen, { min: 0, max: 2, step: 0.05, set: setCol('sharpen') }),
      toggle('Vignette', col.vignette, setCol('vignette')),
    ], h('button', { class: 'btn sm ghost', onclick: () => commit(() => { c.color = defaultColor(); }) }, 'Reset')),
    h('button', { class: 'btn sm ghost', onclick: () => commit((p) => { for (const x of p.clips) x.color = structuredClone(c.color); }) }, 'Apply grade to all clips'),
  ];
}

function textInspector(t) {
  const ta = h('textarea', { rows: 3 }, t.text);
  let began = false;
  ta.addEventListener('input', () => { if (!began) { begin(); began = true; } t.text = ta.value; emit('change', { from: 'inspector' }); });
  ta.addEventListener('change', () => { began = false; save(); });
  const colorIn = h('input', { type: 'color', value: t.color || '#ffffff' });
  colorIn.addEventListener('input', () => { t.color = colorIn.value; emit('change', { from: 'inspector' }); });
  colorIn.addEventListener('change', () => { save(); });
  colorIn.addEventListener('focus', () => begin(), { once: true });
  return [
    h('div', { class: 'insp-title' }, 'Text', h('span', { class: 'badge' }, t.id)),
    group('Content', [ta]),
    group('Timing', [
      slider('Start', t.start, { min: 0, max: Math.max(total(), t.end), step: 0.05, fmt: (v) => `${(+v).toFixed(2)}s`, set: (v) => { const d = t.end - t.start; t.start = v; t.end = v + d; } }),
      slider('Duration', t.end - t.start, { min: 0.2, max: 30, step: 0.1, fmt: (v) => `${(+v).toFixed(1)}s`, set: (v) => (t.end = t.start + v) }),
    ]),
    group('Style', [
      seg('Position', [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']], t.position, (v) => (t.position = v)),
      seg('Font', [['bold', 'Bold'], ['regular', 'Medium'], ['serif', 'Serif'], ['mono', 'Mono']], t.style || 'bold', (v) => (t.style = v)),
      slider('Size', t.size, { min: 16, max: 200, step: 1, fmt: (v) => `${Math.round(v)}px`, set: (v) => (t.size = v) }),
      h('div', { class: 'row wide' }, h('label', {}, 'Color'), colorIn),
      toggle('Background', t.box !== false, (v) => (t.box = v)),
    ]),
  ];
}

function audioInspector(a) {
  const m = mediaFor(a.src);
  return [
    h('div', { class: 'insp-title' }, m?.name || 'Audio', h('span', { class: 'badge' }, a.id)),
    group('Audio', [
      slider('Volume', a.volume, { min: 0, max: 2, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, set: (v) => (a.volume = v) }),
      slider('Start at', a.at, { min: 0, max: Math.max(total(), a.at + 1), step: 0.05, fmt: (v) => `${(+v).toFixed(2)}s`, set: (v) => (a.at = v) }),
      slider('Fade in', a.fadeIn, { min: 0, max: 5, step: 0.1, fmt: (v) => `${(+v).toFixed(1)}s`, set: (v) => (a.fadeIn = v) }),
      slider('Fade out', a.fadeOut, { min: 0, max: 5, step: 0.1, fmt: (v) => `${(+v).toFixed(1)}s`, set: (v) => (a.fadeOut = v) }),
      toggle('Duck under voice', a.duck, (v) => (a.duck = v)),
    ]),
    h('button', { class: 'btn sm ghost', onclick: () => commit(() => { a.end = Math.min(m?.duration ?? a.end, a.start + Math.max(0.5, total() - a.at)); }) }, 'Fit to video length'),
  ];
}

function projectInspector() {
  const p = S.project;
  const bg = h('input', { type: 'color', value: p.background || '#000000' });
  bg.addEventListener('change', () => commit(() => (p.background = bg.value)));
  const ratio = (w, h2) => { const g = (a, b) => (b ? g(b, a % b) : a); const d = g(w, h2); return `${w / d}:${h2 / d}`; };
  return [
    h('div', { class: 'insp-title' }, 'Project'),
    h('div', { class: 'muted small' }, `${p.width}×${p.height} (${ratio(p.width, p.height)}) · ${p.fps} fps · ${dur(total())} · ${p.clips.length} clips · ${p.texts.length} texts · ${p.audio.length} audio`),
    group('Format', [
      seg('Canvas', [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5']], null, (v) => { const A = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] }; [p.width, p.height] = A[v]; }),
      seg('Framing', [['fit', 'Fit'], ['fill', 'Fill / crop']], p.fit, (v) => (p.fit = v)),
      seg('Frame rate', [[24, '24'], [25, '25'], [30, '30'], [60, '60']], p.fps, (v) => (p.fps = v)),
      h('div', { class: 'row wide' }, h('label', {}, 'Background'), bg),
    ]),
    h('p', { class: 'hint' }, 'Select a clip, caption or music item on the timeline to edit it. Everything here is also available to the AI editor — try “make this vertical for Reels”.'),
  ];
}

export function renderInspector() {
  if (!S.project) return;
  const o = selected();
  const kids = !o ? projectInspector() : S.sel.type === 'clip' ? clipInspector(o) : S.sel.type === 'text' ? textInspector(o) : audioInspector(o);
  root.replaceChildren(...kids.filter(Boolean));
}

on('select', renderInspector);
on('change', (o) => { if (o?.from !== 'inspector' && o?.from !== 'drag') renderInspector(); });
on('focus-transition', () => { document.querySelector('[data-rtab="inspector"]').click(); });
