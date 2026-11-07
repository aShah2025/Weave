// Weave Studio entry: wires state, live server sync (SSE), panels and keyboard shortcuts.
import { S, $, $$, on, emit, api, commit, undo, redo, select, total, tc, toast } from './store.js';
import { hydrateIcons, setIcon } from './icons.js';
import { sync, layoutStage, toggle, seek, pause, play } from './player.js';
import { render as renderTimeline, zoomFit, splitAtPlayhead, deleteSelection, duplicateSelection, setTool, setZoom } from './timeline.js';
import { renderInspector } from './inspector.js';
import { renderMedia, renderLibraries, renderChat, renderSwitch, onAgentEvent, openExport, openSettings, onRenderProgress, onRendered, uploadFiles, onTask } from './panels.js';

hydrateIcons();

// ---------- top bar ----------
const projName = $('#projName');
projName.addEventListener('change', () => commit((p) => (p.name = projName.value.trim() || 'Untitled')));
const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '21:9': [2560, 1080] };
const aspectSel = $('#aspectSel');
aspectSel.onchange = () => {
  if (aspectSel.value === 'custom') return;
  commit((p) => { [p.width, p.height] = ASPECTS[aspectSel.value]; if (aspectSel.value === '9:16' || aspectSel.value === '4:5') p.fit = 'fill'; });
};
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#exportBtn').onclick = openExport;
$('#settingsBtn').onclick = openSettings;
$('#switchPill').onclick = () => $('[data-rtab="switch"]').click();
on('saving', (v) => { $('#saveState').textContent = v ? 'Saving…' : 'Saved'; });

function renderTop() {
  const p = S.project;
  if (document.activeElement !== projName) projName.value = p.name || 'Untitled';
  const key = Object.entries(ASPECTS).find(([, [w, h]]) => w * p.height === h * p.width)?.[0];
  aspectSel.replaceChildren(...[...Object.keys(ASPECTS), ...(key ? [] : ['custom'])].map((k) => new Option(k === 'custom' ? `${p.width}×${p.height}` : k, k)));
  aspectSel.value = key || 'custom';
  $('#undoBtn').disabled = !S.undo.length;
  $('#redoBtn').disabled = !S.redo.length;
  $('#tcDur').textContent = tc(total());
}

// ---------- transport ----------
$('#playBtn').onclick = toggle;
$('#toStart').onclick = () => seek(0);
$('#toEnd').onclick = () => seek(total());
const frame = () => 1 / (S.project?.fps || 30);
$('#prevFrame').onclick = () => { pause(); seek(S.t - frame()); };
$('#nextFrame').onclick = () => { pause(); seek(S.t + frame()); };
$('#muteBtn').onclick = () => { S.muted = !S.muted; setIcon($('#muteBtn'), S.muted ? 'mute' : 'volume'); sync(); };
$('#fullBtn').onclick = () => $('#stageWrap').requestFullscreen?.();
on('play', () => setIcon($('#playBtn'), S.playing ? 'pause' : 'play'));
on('time', () => { $('#tcCur').textContent = tc(S.t); });

// ---------- tabs ----------
for (const b of $$('.rail-btn')) b.onclick = () => {
  $$('.rail-btn').forEach((x) => x.classList.toggle('active', x === b));
  $$('.pane').forEach((x) => x.classList.toggle('active', x.dataset.pane === b.dataset.tab));
};
for (const b of $$('.tab')) b.onclick = () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
  $$('.rpane').forEach((x) => x.classList.toggle('active', x.dataset.rpane === b.dataset.rtab));
};

// ---------- drop files anywhere ----------
window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); uploadFiles([...e.dataTransfer.files]); } });

// ---------- keyboard ----------
let shuttle = 0;
window.addEventListener('keydown', (e) => {
  if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (mod && k === 'e') { e.preventDefault(); openExport(); return; }
  if (mod) return;
  switch (k) {
    case ' ': e.preventDefault(); toggle(); break;
    case 'k': pause(); shuttle = 0; break;
    case 'l': shuttle = Math.max(0, shuttle) + 1; if (!S.playing) play(); break;
    case 'j': pause(); seek(S.t - 2); break;
    case 'arrowleft': e.preventDefault(); pause(); seek(S.t - (e.shiftKey ? 1 : frame())); break;
    case 'arrowright': e.preventDefault(); pause(); seek(S.t + (e.shiftKey ? 1 : frame())); break;
    case 'home': seek(0); break;
    case 'end': seek(total()); break;
    case 's': splitAtPlayhead(); break;
    case 'b': setTool('razor'); break;
    case 'v': setTool('select'); break;
    case 'n': $('#snapBtn').click(); break;
    case 'backspace': case 'delete': e.preventDefault(); deleteSelection(); break;
    case 'escape': select(null); setTool('select'); break;
    case '=': case '+': setZoom(+$('#zoom').value + 8); break;
    case '-': setZoom(+$('#zoom').value - 8); break;
    case 'z': if (e.shiftKey) zoomFit(); break;
  }
});

// ---------- full refresh ----------
function renderAll() {
  renderTop();
  layoutStage();
  renderMedia();
  renderLibraries();
  renderTimeline();
  renderInspector();
  renderChat();
  renderSwitch();
  sync();
  emit('time');
}
on('change', renderTop);

// ---------- live sync with the server ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => {
    const st = JSON.parse(e.data);
    const first = !S.project;
    S.project = st.project; S.rev = st.rev;
    S.settings = st.settings; S.sw = st.switch; S.busy = st.busy;
    S.looks = st.looks; S.transitions = st.transitions; S.aspects = st.aspects;
    renderAll();
    if (first) requestAnimationFrame(zoomFit);
  });
  es.addEventListener('project', (e) => {
    const { project, origin } = JSON.parse(e.data);
    if (origin === S.clientId) return;                       // our own save echoing back
    if (origin === null || origin === undefined) {             // media library update (proxy ready etc.)
      S.project.media = project.media;
      renderMedia(); renderLibraries(); renderTimeline(); sync();
      return;
    }
    S.project = project;                                       // AI agent or another window edited
    if (S.sel && ![...project.clips, ...project.texts, ...project.audio].some((x) => x.id === S.sel.id)) S.sel = null;
    emit('change', { from: 'remote' });
  });
  es.addEventListener('checkpoint', (e) => {
    const { project } = JSON.parse(e.data);
    S.undo.push(JSON.stringify({ ...project, media: undefined }));
    S.redo = [];
    renderTop();
  });
  es.addEventListener('agent', (e) => onAgentEvent(JSON.parse(e.data)));
  es.addEventListener('task', (e) => onTask(JSON.parse(e.data)));
  es.addEventListener('render', (e) => onRenderProgress(JSON.parse(e.data)));
  es.addEventListener('rendered', (e) => onRendered(JSON.parse(e.data)));
  es.addEventListener('switch', (e) => { S.sw = JSON.parse(e.data); renderSwitch(); });
  es.addEventListener('settings', (e) => { S.settings = JSON.parse(e.data); renderChat(); });
  es.onerror = () => { $('#saveState').textContent = 'Reconnecting…'; };
  es.onopen = () => { $('#saveState').textContent = ''; };
}
connect();
