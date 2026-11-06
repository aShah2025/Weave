// Left-panel libraries, AI chat, Switch pane, export + settings dialogs.
import { S, $, $$, h, on, emit, api, commit, select, selected, mediaFor, newId, dur, total, toast, esc } from './store.js';
import { icon, hydrateIcons } from './icons.js';
import { addMediaToTimeline } from './timeline.js';
import { pause } from './player.js';

// ---------- media bin ----------
export async function uploadFiles(files) {
  for (const f of files) {
    const t = toast(`Importing ${f.name}…`);
    try { await api(`/api/import?name=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f }); }
    catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
}
const fileInput = $('#fileInput');
$('#importBtn').onclick = () => fileInput.click();
fileInput.onchange = () => { uploadFiles([...fileInput.files]); fileInput.value = ''; };
const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); });

function mediaCard(m) {
  const kindIcon = m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'video';
  const thumb = h('div', { class: 'thumb' });
  if (m.thumbs) Object.assign(thumb.style, { backgroundImage: `url(/media/thumbs/${m.id})`, backgroundSize: `${m.thumbs.count * 100}% 100%`, backgroundPosition: `${(Math.min(2, m.thumbs.count - 1) / (m.thumbs.count - 1)) * 100}% 0` });
  else thumb.innerHTML = icon(kindIcon);
  const card = h('div', { class: 'media-card', draggable: 'true', title: `${m.name}\n${m.width ? `${m.width}×${m.height} · ` : ''}${dur(m.duration)}` },
    thumb,
    h('span', { class: 'kind', html: icon(kindIcon) }),
    h('span', { class: 'dur' }, dur(m.duration)),
    h('button', { class: 'add', title: m.kind === 'audio' ? 'Add at playhead' : 'Append to timeline', html: icon('plus'), onclick: (e) => { e.stopPropagation(); addMediaToTimeline(m); } }),
    h('button', { class: 'rm', title: 'Remove from project', html: icon('trash'), onclick: async (e) => { e.stopPropagation(); if (confirm(`Remove ${m.name} and its clips from the project?`)) await api('/api/media/remove', { method: 'POST', body: { id: m.id } }); } }),
    h('div', { class: 'meta' }, m.name),
    !m.ready && !m.error ? h('div', { class: 'spin' }, 'processing…') : null,
    m.error ? h('div', { class: 'spin', style: { color: 'var(--danger)' } }, 'failed') : null,
  );
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/weave-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
  card.addEventListener('dblclick', () => addMediaToTimeline(m));
  return card;
}
export function renderMedia() {
  const media = S.project.media;
  $('#mediaGrid').replaceChildren(...media.filter((m) => m.kind !== 'audio').map(mediaCard), ...media.filter((m) => m.kind === 'audio').map(mediaCard));
  const audio = media.filter((m) => m.hasAudio);
  $('#audioList').replaceChildren(...(audio.length ? audio.map((m) => {
    const el = h('div', { class: 'list-item', draggable: 'true' }, h('span', { html: icon(m.kind === 'audio' ? 'music' : 'video') }), h('span', { class: 'grow' }, m.name), h('span', { class: 'muted small' }, dur(m.duration)),
      h('button', { class: 'icon-btn', title: 'Add to music track at playhead', html: icon('plus'), onclick: () => addMediaToTimeline({ ...m, kind: 'audio' }) }));
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/weave-media', m.id));
    return el;
  }) : [h('p', { class: 'hint' }, 'Import an MP3 / WAV / M4A to use as music or voice-over.')]));
}

// ---------- text presets ----------
const PRESETS = [
  { label: 'Title', text: 'Your Title', size: 120, position: 'center', style: 'bold', box: false, d: 3 },
  { label: 'Subtitle', text: 'Subtitle', size: 64, position: 'bottom', style: 'regular', box: true, d: 3 },
  { label: 'Caption', text: 'Caption text', size: 52, position: 'bottom', style: 'bold', box: true, d: 2.5 },
  { label: 'Lower third', text: 'Name Surname\nRole', size: 46, position: 'bottom', style: 'regular', box: true, d: 4 },
  { label: 'Hook', text: 'WAIT FOR IT', size: 96, position: 'top', style: 'bold', box: false, color: '#ffd400', d: 2 },
  { label: 'Serif', text: 'Chapter One', size: 90, position: 'center', style: 'serif', box: false, d: 3 },
];
$('#textPresets').replaceChildren(...PRESETS.map((pr) => h('div', {
  class: 'text-preset', onclick: () => commit((p) => {
    const t = { id: newId('t'), text: pr.text, start: S.t, end: S.t + pr.d, position: pr.position, size: pr.size, style: pr.style, box: pr.box, color: pr.color || '#ffffff' };
    p.texts.push(t);
    S.sel = { type: 'text', id: t.id };
    emit('select');
  }),
}, h('div', { style: { fontWeight: pr.style === 'regular' ? 500 : 900, fontFamily: pr.style === 'serif' ? 'Georgia, serif' : 'inherit', fontSize: `${Math.min(20, pr.size / 5)}px`, color: pr.color || '#fff', textShadow: pr.box ? '' : '0 1px 4px #000' } }, pr.label))));

// ---------- transitions & looks ----------
export function renderLibraries() {
  const sel = selected();
  const clipSel = S.sel?.type === 'clip' ? sel : null;
  $('#transGrid').replaceChildren(...['none', ...S.transitions].map((t) => h('div', {
    class: `tile ${clipSel && (clipSel.transition?.type || 'none') === t ? 'active' : ''}`,
    onclick: (e) => {
      const all = e.shiftKey;
      if (!all && !clipSel) return toast('Select a clip first (or shift-click for all cuts)');
      if (!all && S.project.clips.indexOf(clipSel) === 0) return toast('The first clip has nothing to transition from');
      commit((p) => { for (const c of all ? p.clips.slice(1) : [clipSel]) c.transition = t === 'none' ? null : { type: t, duration: c.transition?.duration || 0.5 }; });
    },
  }, h('div', { class: 'sw', style: { background: transSwatch(t) } }), t)));
  const frame = clipSel && mediaFor(clipSel.src);
  $('#looksGrid').replaceChildren(...S.looks.map((l) => h('div', {
    class: `tile ${clipSel && (clipSel.color?.look || 'none') === l ? 'active' : ''}`,
    onclick: (e) => {
      const all = e.shiftKey;
      if (!all && !clipSel) return toast('Select a clip first (or shift-click for all)');
      commit((p) => { for (const c of all ? p.clips : [clipSel]) c.color = { ...c.color, look: l }; });
    },
  }, h('div', { class: 'sw', style: { backgroundImage: frame?.thumbs ? `url(/media/thumbs/${frame.id})` : 'linear-gradient(135deg,#e9a46b,#3a6ea5)', backgroundSize: frame?.thumbs ? `${frame.thumbs.count * 100}% 100%` : 'cover', backgroundPosition: '10% 0', filter: lookCss(l) } }), l === 'none' ? 'Original' : l.replace('_', ' / '))));
}
const transSwatch = (t) => ({
  none: '#2a2c32', fade: 'linear-gradient(90deg,#2ee6d6,#8b5cf6)', dissolve: 'radial-gradient(#2ee6d6 30%,#8b5cf6)', fadeblack: 'linear-gradient(90deg,#2ee6d6,#000,#8b5cf6)', fadewhite: 'linear-gradient(90deg,#2ee6d6,#fff,#8b5cf6)',
  wipeleft: 'linear-gradient(90deg,#8b5cf6 50%,#2ee6d6 50%)', wiperight: 'linear-gradient(90deg,#2ee6d6 50%,#8b5cf6 50%)', slideleft: 'linear-gradient(90deg,#2ee6d6 30%,#111 30% 34%,#8b5cf6 34%)', slideright: 'linear-gradient(90deg,#8b5cf6 66%,#111 66% 70%,#2ee6d6 70%)',
  circleopen: 'radial-gradient(circle,#8b5cf6 35%,#2ee6d6 36%)', radial: 'conic-gradient(#8b5cf6 0 120deg,#2ee6d6 120deg)', smoothleft: 'linear-gradient(90deg,#8b5cf6,#2ee6d6 70%)', zoomin: 'radial-gradient(circle,#8b5cf6 20%,#2ee6d6 60%)',
})[t] || '#333';
import { cssFilter } from './store.js';
const lookCss = (l) => cssFilter({ look: l });

// ---------- AI chat ----------
const chatEl = $('#chat'), promptEl = $('#prompt');
const CHIPS = ['Cut the dead air', 'Make it 9:16 for Reels', 'Cinematic color grade', 'Add a title card', 'Add music, ducked', 'Smooth transitions between cuts', 'Tighten to under 60s'];
$('#chips').replaceChildren(...CHIPS.map((c) => h('button', { class: 'chip', onclick: () => { promptEl.value = c; promptEl.focus(); } }, c)));

export function renderChat() {
  const items = S.chat.map((m) => {
    if (m.kind === 'tool') return h('div', { class: `tool-chip ${m.bad ? 'bad' : ''}`, title: m.detail }, h('b', {}, m.name), m.summary);
    const src = m.source === 'switch' ? h('span', { class: 'src switch' }, `${m.who || 'teammate'} · via Switch`) : m.kind === 'ai' ? h('span', { class: 'src' }, 'Weave AI') : null;
    return h('div', { class: `msg ${m.kind}` }, src, m.text);
  });
  if (!items.length) items.push(h('div', { class: 'chat-empty', html: `${icon('sparkle')}<p><b>AI Editor</b><br>Describe the edit in plain English. Claude watches your footage, cuts, grades, adds music and captions — live on this timeline. Every step is undoable.</p>${S.settings.hasApiKey ? '' : '<p style="color:var(--warn)">Add your Anthropic API key in Settings first.</p>'}` }));
  if (S.busy) items.push(h('div', { class: 'thinking' }, h('i'), h('i'), h('i')));
  $('#chips').hidden = S.chat.length > 0;
  chatEl.replaceChildren(...items);
  chatEl.scrollTop = chatEl.scrollHeight;
  $('#stopBtn').hidden = !S.busy;
  $('#sendBtn').disabled = S.busy;
  $('#modelLbl').textContent = S.settings.model || '';
}
function summarize(name, input) {
  const i = input || {};
  if (name === 'remove_ranges') return ` ${i.ranges?.length} span(s)`;
  if (name === 'view_frames') return ` ${(i.times || []).length} frame(s)`;
  if (name === 'add_text') return ` “${i.text}”`;
  if (name === 'set_color') return ` ${i.clip_id} ${i.look || ''}`;
  const parts = Object.entries(i).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${String(v).split('/').pop()}`);
  return parts.length ? ` ${parts.join(' ').slice(0, 80)}` : '';
}
export function onAgentEvent(e) {
  if (e.type === 'user') { S.busy = true; S.chat.push({ kind: 'user', text: e.text, source: e.source, who: e.who }); }
  else if (e.type === 'text') S.chat.push({ kind: 'ai', text: e.text, source: e.source === 'switch' ? 'ai' : undefined });
  else if (e.type === 'tool') S.chat.push({ kind: 'tool', name: e.name, summary: summarize(e.name, e.input), detail: JSON.stringify(e.input) });
  else if (e.type === 'tool_error') { const last = [...S.chat].reverse().find((m) => m.kind === 'tool' && m.name === e.name); if (last) { last.bad = true; last.detail = e.error; } }
  else if (e.type === 'error') { S.busy = false; S.chat.push({ kind: 'err', text: e.text }); }
  else if (e.type === 'done') S.busy = false;
  if (S.chat.length > 400) S.chat.splice(0, S.chat.length - 400);
  renderChat();
}
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = promptEl.value.trim();
  if (!message || S.busy) return;
  if (!S.settings.hasApiKey) { toast('Add your Anthropic API key in Settings', 'err'); openSettings(); return; }
  pause();
  promptEl.value = '';
  try { await api('/api/agent', { method: 'POST', body: { message } }); } catch (err) { toast(err.message, 'err'); }
});
promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#stopBtn').onclick = () => api('/api/agent/stop', { method: 'POST' });

// ---------- Switch ----------
export function renderSwitch() {
  const s = S.sw || {};
  const pill = $('#switchPill');
  pill.classList.toggle('on', !!s.connected);
  pill.classList.toggle('err', !s.connected && !!s.enabled);
  pill.querySelector('.lbl').textContent = s.connected ? 'Switch live' : s.enabled ? 'Switch…' : 'Switch';
  const pane = $('#switchPane');
  const hero = h('div', { class: 'sw-hero', html: `<h3>${icon('chat')} Edit from Slack &amp; Discord</h3><p>Weave joins your team chat as an agent through <b>Switch</b>. Teammates @mention it with footage and an edit request; it edits right here, posts a preview, and exports when a human approves.</p>
    <div class="sw-flow"><div><b>1</b><span><code>@weave</code> + a clip: “cut the dead air, add captions, 9:16”</span></div><div><b>2</b><span>Weave edits live on this timeline (watch it happen)</span></div><div><b>3</b><span>A preview video is posted back in the thread</span></div><div><b>4</b><span>Reply <b>approve</b> → full-quality export lands in chat</span></div></div>` });
  if (!s.configured) {
    const url = h('input', { placeholder: 'http://localhost:8000', value: s.url || '' });
    const reg = h('input', { type: 'password', placeholder: 'Registration key (Gateway → API Keys)' });
    const aid = h('input', { placeholder: 'Agent id' }), akey = h('input', { type: 'password', placeholder: 'Agent API key' });
    const addr = h('select', {}, h('option', { value: 'anyone' }, 'Anyone in the room'), h('option', { value: 'owner_and_owner_agents' }, 'Me and my agents'), h('option', { value: 'owner_only' }, 'Only me'));
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true;
      try { S.sw = await api('/api/switch/connect', { method: 'POST', body: { url: url.value.trim(), registrationKey: reg.value.trim() || undefined, agentId: aid.value.trim() || undefined, apiKey: akey.value.trim() || undefined, addressing: addr.value } }); toast('Switch configured', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      btn.disabled = false; renderSwitch();
    } }, 'Connect to Switch');
    pane.replaceChildren(hero,
      h('div', { class: 'field' }, h('label', {}, 'Switch server address'), url),
      h('div', { class: 'field' }, h('label', {}, 'Register a new agent'), reg),
      h('div', { class: 'or' }, '— or use an existing agent —'),
      h('div', { class: 'field-row' }, h('div', { class: 'field' }, aid), h('div', { class: 'field' }, akey)),
      h('div', { class: 'field' }, h('label', {}, 'Who can instruct Weave'), addr),
      btn,
      h('p', { class: 'hint', html: 'Run <a href="https://github.com/sandbox-quantum/switch/releases/latest" target="_blank" style="color:var(--accent)">Switch Console</a>, connect your Slack or Discord workspace, then create a registration key on the Gateway’s <b>API Keys</b> page.' }));
    return;
  }
  const feed = (s.activity || []).slice().reverse().map((a) => h('div', { class: `feed-item ${a.kind}` }, h('span', { class: 't' }, new Date(a.at).toLocaleTimeString()), a.who ? h('b', {}, `${a.who}: `) : '', a.text));
  pane.replaceChildren(hero,
    h('div', { class: 'group' }, h('h4', {}, 'Connection'), h('div', { class: 'rows' },
      h('div', { class: 'row wide' }, h('label', {}, 'Status'), h('span', { style: { color: s.connected ? 'var(--ok)' : 'var(--warn)' } }, s.connected ? '● Connected' : s.enabled ? '○ Reconnecting…' : '○ Paused')),
      h('div', { class: 'row wide' }, h('label', {}, 'Server'), h('span', { class: 'small' }, s.url)),
      h('div', { class: 'row wide' }, h('label', {}, 'Agent'), h('span', { class: 'small' }, `${s.name} · ${s.agentId}`)),
      h('div', { class: 'row wide' }, h('label', {}, 'Rooms'), h('span', { class: 'small' }, s.rooms?.length ? `${s.rooms.length} joined` : 'invite @weave to a channel')),
      s.error ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, s.error) : null,
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm', onclick: async () => { try { await api('/api/switch/share', { method: 'POST' }); toast('Shared to chat', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Share last export'),
        s.enabled ? h('button', { class: 'btn sm ghost', onclick: async () => { S.sw = await api('/api/switch/disconnect', { method: 'POST' }); renderSwitch(); } }, 'Disconnect')
          : h('button', { class: 'btn sm', onclick: async () => { try { S.sw = await api('/api/switch/connect', { method: 'POST', body: { url: s.url, agentId: s.agentId, apiKey: undefined, reuse: true } }); } catch (e) { toast(e.message, 'err'); } renderSwitch(); } }, 'Reconnect'),
      ))),
    h('div', { class: 'group' }, h('h4', {}, 'Chat activity'), h('div', { class: 'rows feed' }, feed.length ? feed : h('span', { class: 'muted small' }, 'Mention @weave in a channel to start.'))),
  );
}

// ---------- export dialog ----------
const expModal = $('#exportModal');
export function openExport() {
  if (!S.project.clips.length) return toast('Add something to the timeline first');
  pause();
  $('#expName').value = S.project.name || 'weave';
  $('#expRes').textContent = `${S.project.width}×${S.project.height} · ${S.project.fps} fps · ${dur(total())}`;
  $('#expResult').replaceChildren();
  expModal.hidden = false;
}
async function startExport(preview) {
  $('#expProgress').hidden = false;
  $('#expGo').disabled = $('#expPreview').disabled = true;
  $('#expCancel').hidden = false;
  $('#expResult').replaceChildren();
  try { await api('/api/export', { method: 'POST', body: { quality: $('#expQuality').value, preview, name: $('#expName').value } }); }
  catch (e) { toast(e.message, 'err'); resetExport(); }
}
function resetExport() { $('#expGo').disabled = $('#expPreview').disabled = false; $('#expCancel').hidden = true; }
$('#expGo').onclick = () => startExport(false);
$('#expPreview').onclick = () => startExport(true);
$('#expCancel').onclick = () => api('/api/export/cancel', { method: 'POST' });
export function onRenderProgress(r) {
  const bar = $('#expProgress');
  if (r.error) { toast(r.error.split('\n')[0], 'err'); resetExport(); bar.hidden = true; return; }
  bar.hidden = false;
  bar.querySelector('.bar').style.width = `${Math.round(r.progress * 100)}%`;
  bar.querySelector('span').textContent = `${r.label === 'preview' ? 'Preview' : 'Exporting'} ${Math.round(r.progress * 100)}%`;
  let badge = $('.render-badge');
  if (r.progress < 1) { if (!badge) $('#stage').append(badge = h('div', { class: 'render-badge' })); badge.textContent = `rendering ${Math.round(r.progress * 100)}%`; }
  else badge?.remove();
}
export function onRendered(r) {
  resetExport();
  $('.render-badge')?.remove();
  toast(`${r.preview ? 'Preview' : 'Export'} ready · ${(r.bytes / 1048576).toFixed(1)} MB`, 'ok');
  if (expModal.hidden) return;
  $('#expProgress').hidden = true;
  $('#expResult').replaceChildren(
    h('video', { src: `${r.url}?t=${Date.now()}`, controls: true }),
    h('div', { class: 'result-actions' },
      h('a', { class: 'btn primary', href: r.url, download: '', html: `${icon('download')}Download` }),
      S.sw?.connected ? h('button', { class: 'btn', html: `${icon('send')}Send to Slack/Discord`, onclick: async () => { try { await api('/api/switch/share', { method: 'POST' }); toast('Posted to chat via Switch', 'ok'); } catch (e) { toast(e.message, 'err'); } } }) : null,
      h('span', { class: 'muted small', style: { alignSelf: 'center' } }, `${r.resolution} · ${r.duration}s`)),
  );
}

// ---------- settings ----------
const setModal = $('#settingsModal');
export function openSettings() {
  $('#setKey').value = '';
  $('#keyState').textContent = S.settings.hasApiKey ? '✓ A key is configured. Leave blank to keep it.' : 'No key yet — needed for the AI editor.';
  $('#setModel').value = S.settings.model;
  setModal.hidden = false;
}
$('#setSave').onclick = async () => {
  const body = { model: $('#setModel').value };
  if ($('#setKey').value.trim()) body.apiKey = $('#setKey').value.trim();
  try { S.settings = await api('/api/settings', { method: 'POST', body }); toast('Settings saved', 'ok'); setModal.hidden = true; renderChat(); }
  catch (e) { toast(e.message, 'err'); }
};
for (const m of $$('.modal')) {
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; });
}

on('change', () => { renderMedia(); renderLibraries(); });
on('select', renderLibraries);
