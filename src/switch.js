// Switch bridge: puts the Weave editing agent into Slack / Discord / Teams / Telegram rooms via Switch
// (https://github.com/sandbox-quantum/switch), speaking the Switch Agent Protocol directly:
//
//   register   POST {server}/agents                      (registration key) -> {id, api_key}
//   events     WS   {server}/agents/{id}/connection/ws   (agent key; ping -> pong{cursor})
//   reply      POST {server}/agents/{id}/message         {room_id, content}
//   files      POST {server}/agents/{id}/rooms/{room}/media   multipart: file, caption, thread_id
//   download   GET  {server}/agents/{id}/rooms/{room}/media?mxc=...
//   typing     POST {server}/agents/{id}/typing          {room_id, is_typing}
//
// Workflow in chat:  @weave cut the silences and add captions  → agent edits live in the studio,
// posts a preview video into the thread → teammate replies "approve" → full-quality export is posted.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_UPLOAD = 24 * 1024 * 1024; // stay under Slack/Discord bot upload limits
const APPROVE = /^\s*(approve|approved|ship it|lgtm|export( it)?|final( cut)?|looks good)\b/i;
const STATUS = /^\s*(status|timeline)\s*\??$/i;
const STOP = /^\s*(stop|cancel)\b/i;
const HELP = /^\s*(help|\?)\s*$/i;

export class SwitchBridge {
  constructor(studio, { log = console.log } = {}) {
    this.studio = studio;
    this.log = log;
    this.ws = null;
    this.connected = false;
    this.cursor = 0;
    this.generation = null;
    this.rooms = [];
    this.activity = [];   // recent chat activity for the UI
    this.lastRoom = null;
    this.stopped = true;
    this.backoff = 1000;
    this.awaitingApproval = new Map(); // room -> preview result
  }

  get cfg() { return this.studio.config.switch || {}; }
  get base() { return (this.cfg.url || '').replace(/\/+$/, ''); }

  status() {
    const c = this.cfg;
    return {
      configured: !!(c.url && c.agentId && c.apiKey), enabled: !!c.enabled, connected: this.connected,
      url: c.url || '', agentId: c.agentId || '', name: c.name || 'weave', addressing: c.addressing || 'anyone',
      rooms: this.rooms, activity: this.activity.slice(-40), error: this.error || null,
    };
  }

  note(kind, text, extra = {}) {
    const item = { at: Date.now(), kind, text, ...extra };
    this.activity.push(item);
    if (this.activity.length > 200) this.activity.shift();
    this.studio.broadcast('switch', this.status());
  }

  async api(method, p, { json, form, key = this.cfg.apiKey, headers = {} } = {}) {
    const res = await fetch(`${this.base}${p}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : form,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Switch ${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  // Register a new agent (with a registration key from the Switch Gateway's API Keys page),
  // or accept existing credentials, then connect.
  async configure({ url, registrationKey, agentId, apiKey, name = 'weave', addressing = 'anyone' }) {
    if (!url) throw new Error('Switch server URL is required');
    // Reconnect with stored credentials.
    if (!registrationKey && !apiKey && this.cfg.apiKey && (!agentId || agentId === this.cfg.agentId)) { agentId = this.cfg.agentId; apiKey = this.cfg.apiKey; }
    this.stop();
    this.studio.config.switch = { ...this.cfg, url: url.replace(/\/+$/, ''), name, addressing };
    if (registrationKey) {
      const reg = await this.api('POST', '/agents', {
        key: registrationKey,
        json: {
          name: name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
          display_name: 'Weave',
          description: 'AI video editor. Mention me with an edit ("cut the dead air, add captions, make it 9:16") and I edit the timeline, post a preview, and export when you approve.',
          connector_type: 'weave',
          integration_profile: { connection_model: 'always_on', message_exchange: true, pre_invocation_mediation: [], post_invocation_mediation: [], event_reporting: [] },
          tools: ['video-editing', 'ffmpeg'],
          overwrite: true,
        },
      });
      agentId = reg.id; apiKey = reg.api_key;
      this.note('system', `Registered agent "${name}" (${agentId})`);
    }
    if (!agentId || !apiKey) throw new Error('Provide a registration key, or an existing agent id + API key');
    Object.assign(this.studio.config.switch, { agentId, apiKey, enabled: true, connectionId: this.cfg.connectionId || crypto.randomUUID() });
    this.studio.saveConfig();
    if (addressing) {
      try { await this.api('POST', `/agents/${agentId}/ops/update_agent_detail`, { json: { agent_id: agentId, addressing } }); }
      catch (e) { this.note('warn', `Could not set addressing: ${e.message}`); }
    }
    await this.start();
  }

  async start() {
    if (!this.status().configured) throw new Error('Switch is not configured');
    if (typeof WebSocket === 'undefined') throw new Error('Node 22+ is required for the Switch WebSocket');
    this.stopped = false;
    this.error = null;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryT); clearInterval(this.watchdog);
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
    this.studio.broadcast?.('switch', this.status());
  }

  open() {
    if (this.stopped) return;
    const c = this.cfg;
    const params = new URLSearchParams({
      connection_id: c.connectionId, scope: 'all', filter: 'addressed',
      start_from: this.cursor > 0 ? String(this.cursor) : 'head', client: 'weave', client_version: '0.2.0',
    });
    if (this.generation !== null) params.set('expected_generation', String(this.generation));
    const url = `${this.base.replace(/^http/, 'ws')}/agents/${c.agentId}/connection/ws?${params}`;
    let ws;
    try { ws = new WebSocket(url, { headers: { Authorization: `Bearer ${c.apiKey}` } }); }
    catch (e) { return this.retry(e.message); }
    this.ws = ws;
    let lastFrame = Date.now();
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => { if (Date.now() - lastFrame > 15000) { this.log('heartbeat lost, reconnecting'); try { ws.close(); } catch {} } }, 5000);

    ws.addEventListener('open', () => { this.backoff = 1000; });
    ws.addEventListener('message', (ev) => {
      lastFrame = Date.now();
      let frame;
      try { frame = JSON.parse(String(ev.data)); } catch { return; }
      this.onFrame(frame).catch((e) => this.log(`frame error: ${e.message}`));
    });
    ws.addEventListener('close', (ev) => {
      clearInterval(this.watchdog);
      const was = this.connected;
      this.connected = false;
      if (was) this.note('system', 'Disconnected from Switch');
      if (ev.code === 4001 || /taken_over/.test(ev.reason || '')) { this.error = 'Another connection took over this agent'; this.stopped = true; this.studio.broadcast('switch', this.status()); return; }
      this.retry(ev.reason || `socket closed (${ev.code})`);
    });
    ws.addEventListener('error', () => {});
  }

  retry(reason) {
    if (this.stopped) return;
    this.error = reason;
    this.studio.broadcast('switch', this.status());
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  async onFrame(frame) {
    const ev = frame.event;
    if (ev === 'ping') { this.ws?.send(JSON.stringify({ type: 'pong', cursor: this.cursor })); return; }
    if (typeof frame.id === 'number' && frame.id > this.cursor) this.cursor = frame.id;
    const data = frame.data || {};
    if (ev === 'connection_state') {
      this.connected = true; this.error = null;
      if (typeof data.generation === 'number') this.generation = data.generation;
      if (typeof data.cursor === 'number' && data.cursor > this.cursor) this.cursor = data.cursor;
      this.rooms = Array.isArray(data.rooms) ? data.rooms : [];
      this.note('system', `Connected to Switch${this.rooms.length ? ` · ${this.rooms.length} room(s)` : ''}`);
      return;
    }
    if (ev === 'evicted' || ev === 'refused') { this.error = `Switch ${ev}: ${JSON.stringify(data).slice(0, 200)}`; this.stopped = ev === 'evicted'; this.note('warn', this.error); return; }
    if (ev === 'gap') { this.note('warn', 'Missed some events while offline'); return; }
    if (ev === 'room_join' || data.type === 'room_join') {
      if (data.room_id && !this.rooms.includes(data.room_id)) this.rooms.push(data.room_id);
      return;
    }
    if (ev === 'message' || data.type === 'message') return this.onMessage(data);
  }

  async onMessage(data) {
    const payload = data.payload || {};
    if (!payload.addressed) return;
    const room = data.room_id;
    const who = payload.sender_name || payload.sender || 'someone';
    const thread = payload.thread_id || payload.message_id || null;
    const text = String(payload.body || '').replace(/<@[^>]+>/g, '').replace(/^\s*@?weave\b[:,]?\s*/i, '').trim();
    this.lastRoom = { room, thread };
    this.note('in', text || '(attachment)', { who, room });

    // Inbound footage: download into the studio's media folder.
    const imported = [];
    for (const att of payload.attachments || []) {
      if (!/^(video|audio|image)\//.test(att.mimetype || '')) continue;
      try { imported.push(await this.download(room, att)); }
      catch (e) { await this.say(room, `Couldn't fetch ${att.filename}: ${e.message}`); }
    }
    if (imported.length) await this.say(room, `📥 Imported ${imported.map((m) => `\`${m.name}\``).join(', ')} into the studio.`);
    if (!text) { if (imported.length) await this.say(room, 'Tell me what to do with it — e.g. "make a 30s vertical highlight with captions".'); return; }

    if (HELP.test(text)) return this.say(room, HELP_TEXT);
    if (STOP.test(text)) { this.studio.agentAbort?.abort(); this.studio.exportAbort?.abort(); return this.say(room, '⏹ Stopped.'); }
    if (STATUS.test(text)) return this.say(room, summary(this.studio));
    if (APPROVE.test(text) && text.split(/\s+/).length <= 4) return this.approve(room, thread, who);

    await this.typing(room, true);
    await this.say(room, `🎬 On it, ${who}. Watch it happen live in Weave Studio.`);
    try {
      const final = await this.studio.agent(text, {
        source: 'switch', who,
        roots: [this.studio.dir],
        extraContext: `This request came from ${who} in a team chat (Slack/Discord/Teams) via Switch.${imported.length ? ` They just attached: ${imported.map((m) => m.path).join(', ')}.` : ''} When you're done editing, render a PREVIEW (preview=true) so the team can review it in chat — the human approves the final export by replying "approve". Only render the final if they explicitly ask for it now.`,
        hooks: { onRendered: (r) => this.postRender(room, thread, r) },
      });
      await this.say(room, `${final}\n\nReply *approve* to export in full quality, or tell me what to change.`);
    } catch (e) {
      await this.say(room, `⚠️ ${e.message}`);
    } finally {
      await this.typing(room, false);
    }
  }

  async approve(room, thread, who) {
    if (!this.studio.project.clips.length) return this.say(room, 'The timeline is empty — nothing to export yet.');
    await this.say(room, `✅ Approved by ${who}. Exporting full quality…`);
    await this.typing(room, true);
    try {
      const r = await this.studio.export({ quality: 'high' });
      await this.postRender(room, thread, r);
    } catch (e) { await this.say(room, `⚠️ Export failed: ${e.message}`); }
    finally { await this.typing(room, false); }
  }

  async postRender(room, thread, r) {
    const mb = (r.bytes / 1048576).toFixed(1);
    const caption = `${r.preview ? '👀 Preview' : '🎞 Final export'} · ${r.duration}s · ${r.resolution} · ${mb} MB`;
    if (r.bytes > MAX_UPLOAD) return this.say(room, `${caption}\nToo large to upload here — it's saved at \`${r.output}\`.`);
    try { await this.upload(room, r.output, caption, thread); this.note('out', caption, { room }); }
    catch (e) { await this.say(room, `${caption}\n(Upload failed: ${e.message}. Saved at \`${r.output}\`.)`); }
  }

  // Share the latest export into the last active room (from the studio's "Share" button).
  async share(file, caption) {
    if (!this.connected) throw new Error('Switch is not connected');
    const target = this.lastRoom?.room || this.rooms[0];
    if (!target) throw new Error('No Switch room yet — mention @weave in a channel first');
    await this.upload(target, file, caption, this.lastRoom?.thread);
    this.note('out', caption, { room: target });
  }

  async say(room, content) {
    try { await this.api('POST', `/agents/${this.cfg.agentId}/message`, { json: { room_id: room, content } }); this.note('out', content, { room }); }
    catch (e) { this.log(`send failed: ${e.message}`); }
  }

  async typing(room, is_typing) {
    try { await this.api('POST', `/agents/${this.cfg.agentId}/typing`, { json: { room_id: room, is_typing } }); } catch {}
  }

  async upload(room, file, caption, thread) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
    if (caption) form.append('caption', caption);
    if (thread) form.append('thread_id', thread);
    return this.api('POST', `/agents/${this.cfg.agentId}/rooms/${encodeURIComponent(room)}/media`, { form });
  }

  async download(room, att) {
    const res = await fetch(`${this.base}/agents/${this.cfg.agentId}/rooms/${encodeURIComponent(room)}/media?mxc=${encodeURIComponent(att.mxc)}`, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const name = path.basename(att.filename || `chat-${Date.now()}`).replace(/[^\w.\- ]+/g, '_');
    let dest = path.join(this.studio.mediaDir, name);
    if (fs.existsSync(dest)) dest = path.join(this.studio.mediaDir, `${path.parse(name).name}-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return this.studio.ensureMedia(dest);
  }
}

function summary(studio) {
  const p = studio.project;
  const dur = p.clips.reduce((s, c) => s + (c.end - c.start) / c.speed, 0);
  return `📋 *${p.name}* · ${p.width}x${p.height} · ~${dur.toFixed(1)}s\n${p.clips.length} clip(s), ${p.audio.length} audio, ${p.texts.length} text · media: ${p.media.map((m) => m.name).join(', ') || 'none'}`;
}

const HELP_TEXT = `I'm *Weave*, your video editor. Try:
• attach a video and say "cut the dead air and add captions"
• "make it 9:16 for TikTok with a cinematic look"
• "add the lofi track under everything, ducked"
• *status* – what's on the timeline · *approve* – export final · *stop* – cancel`;
