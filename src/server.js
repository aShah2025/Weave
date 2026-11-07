// Weave Studio server: zero-dependency Node HTTP server.
// Serves the editor UI, media (with HTTP range support), live updates over SSE,
// exports, the AI agent, and the Switch bridge (Slack / Discord / Teams / Telegram).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as T from './timeline.js';
import * as F from './ffmpeg.js';
import * as O from './ops.js';
import { runAgent, DEFAULT_MODEL } from './agent.js';
import { SwitchBridge } from './switch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm', '.webp': 'image/webp', '.gif': 'image/gif' };
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi)$/i, AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg)$/i, IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

export class Studio {
  constructor(dir, { log = console.log } = {}) {
    this.dir = path.resolve(dir);
    this.log = log;
    this.mediaDir = path.join(this.dir, 'media');
    this.exportsDir = path.join(this.dir, 'exports');
    this.cfgFile = path.join(this.dir, '.weave', 'config.json');
    this.projFile = path.join(this.dir, 'weave.project.json');
    for (const d of [this.mediaDir, this.exportsDir, path.dirname(this.cfgFile)]) fs.mkdirSync(d, { recursive: true });
    this.config = fs.existsSync(this.cfgFile) ? JSON.parse(fs.readFileSync(this.cfgFile, 'utf8')) : {};
    this.project = fs.existsSync(this.projFile) ? T.load(this.projFile) : T.newProject();
    this.rev = 1;
    this.clients = new Set();
    this.history = [];          // agent conversation (shared by UI + chat)
    this.queue = Promise.resolve();
    this.agentAbort = null;
    this.exportAbort = null;
    this.lastExport = null;
    this.processing = new Map(); // media path -> promise
    this.switch = new SwitchBridge(this, { log: (m) => this.log(`[switch] ${m}`) });
  }

  get apiKey() { return this.config.apiKey || process.env.ANTHROPIC_API_KEY; }
  get model() { return this.config.model || DEFAULT_MODEL; }
  saveConfig() { fs.writeFileSync(this.cfgFile, JSON.stringify(this.config, null, 2), { mode: 0o600 }); }

  // ---------- live sync ----------
  broadcast(type, data, except) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) if (c !== except) c.write(msg);
  }
  changed(origin) {
    this.rev++;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => T.save(this.project, this.projFile), 300);
    this.broadcast('project', { project: this.project, rev: this.rev, origin: origin ?? null });
  }

  // ---------- media ----------
  async ensureMedia(file) {
    file = path.resolve(file);
    if (this.processing.has(file)) return this.processing.get(file);
    const job = (async () => {
      const info = await F.probe(file);
      const kind = info.isImage ? 'image' : info.hasVideo ? 'video' : 'audio';
      const m = T.registerMedia(this.project, { path: file, name: path.basename(file), kind, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio, hasVideo: info.hasVideo, ready: false });
      this.changed();
      // Derivatives are generated in the background so the agent and UI never wait on them.
      (async () => {
        try {
          const [proxy, thumbs, peaks] = await Promise.all([F.makeProxy(file, info), F.makeThumbs(file, info), F.makePeaks(file, info)]);
          Object.assign(m, { proxy, thumbs: thumbs && { count: thumbs.count, w: thumbs.w, h: thumbs.h }, thumbsPath: thumbs?.path, hasPeaks: !!peaks, ready: true });
          this._peaks ??= new Map(); if (peaks) this._peaks.set(m.id, peaks);
          this.changed();
        } catch (e) { m.error = e.message; this.changed(); this.log(`media processing failed for ${file}: ${e.message}`); }
      })();
      return m;
    })();
    this.processing.set(file, job);
    job.catch(() => this.processing.delete(file));
    return job;
  }

  // ---------- agent ----------
  // Every agent run (from the editor or from Slack/Discord via Switch) goes through one queue.
  agent(instruction, { source = 'editor', who, extraContext = '', hooks = {}, onEvent = () => {}, roots = null } = {}) {
    const run = async () => {
      const ctrl = new AbortController();
      this.agentAbort = ctrl;
      const emit = (e) => { this.broadcast('agent', { ...e, source, who }); onEvent(e); };
      emit({ type: 'user', text: instruction });
      // Agent edits are snapshotted so the editor's undo can roll them back.
      this.broadcast('checkpoint', { project: structuredClone(this.project), label: `AI: ${instruction.slice(0, 40)}` });
      try {
        const { messages } = await runAgent({
          instruction, project: this.project, cwd: this.mediaDir, exportsDir: this.exportsDir, apiKey: this.apiKey, model: this.model,
          history: this.history.slice(-30), signal: ctrl.signal, context: extraContext, roots,
          hooks: {
            onChange: () => this.changed('agent'),
            onMedia: (p) => this.ensureMedia(p),
            onProgress: (label, f) => this.broadcast('render', { label, progress: f }),
            onRendered: async (r) => { this.lastExport = r; this.broadcast('rendered', { ...r, url: `/exports/${path.basename(r.output)}` }); await hooks.onRendered?.(r); },
          },
          onEvent: emit,
        });
        // Keep conversation compact: text-only memory of past turns.
        const finalText = messages.at(-1)?.content?.filter?.((b) => b.type === 'text').map((b) => b.text).join('\n') || 'Done.';
        this.history.push({ role: 'user', content: `${who ? `[${who} via ${source}] ` : ''}${instruction}` }, { role: 'assistant', content: finalText });
        return finalText;
      } catch (e) {
        emit({ type: 'error', text: e.message });
        throw e;
      } finally {
        this.agentAbort = null;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  // ---------- export ----------
  async export({ quality = 'high', preview = false, name } = {}) {
    if (this.exportAbort) throw new Error('An export is already running');
    const ctrl = new AbortController();
    this.exportAbort = ctrl;
    const slug = (name || this.project.name || 'weave').replace(/[^\w-]+/g, '-').toLowerCase();
    const out = path.join(this.exportsDir, `${slug}${preview ? '-preview' : ''}.mp4`);
    try {
      const r = await F.render(this.project, out, { quality, preview, signal: ctrl.signal, onProgress: (f) => this.broadcast('render', { label: preview ? 'preview' : 'export', progress: f }) });
      const res = { ...r, preview, bytes: fs.statSync(out).size, url: `/exports/${path.basename(out)}` };
      this.lastExport = res;
      this.broadcast('rendered', res);
      return res;
    } finally { this.exportAbort = null; }
  }

  state() {
    return {
      project: this.project, rev: this.rev, dir: this.dir,
      settings: { hasApiKey: !!this.apiKey, model: this.model },
      switch: this.switch.status(),
      busy: !!this.agentAbort,
      transitions: T.TRANSITIONS, looks: T.LOOKS, aspects: Object.keys(T.ASPECTS),
    };
  }
}

// ---------- HTTP ----------
function sendFile(req, res, file, type) {
  let stat;
  try { stat = fs.statSync(file); } catch { res.writeHead(404); return res.end('not found'); }
  const ct = type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : stat.size - 1;
    res.writeHead(206, { 'Content-Type': ct, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': ct, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const body = (req, limit = 20e6) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(n ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(e); } });
});

export function startServer({ dir = process.cwd(), port = 4321, host = '127.0.0.1', log = console.log } = {}) {
  const studio = new Studio(dir, { log });
  // Re-hydrate derivatives for media already in the project.
  for (const m of studio.project.media) if (fs.existsSync(m.path)) studio.ensureMedia(m.path).catch(() => {});

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      // Same-origin only for mutating requests (blocks drive-by requests from other sites).
      if (req.method !== 'GET' && req.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) return json(res, 403, { error: 'cross-origin request refused' });

      if (p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify(studio.state())}\n\n`);
        studio.clients.add(res);
        const ka = setInterval(() => res.write(': ka\n\n'), 15000);
        req.on('close', () => { clearInterval(ka); studio.clients.delete(res); });
        return;
      }
      if (p === '/api/state') return json(res, 200, studio.state());
      if (p === '/api/project' && req.method === 'PUT') {
        const { project, clientId } = await body(req);
        // Replace contents in place: a running agent holds a reference to this object.
        // The server stays authoritative for the media library (proxy/thumbnail state).
        const media = studio.project.media;
        for (const k of Object.keys(studio.project)) delete studio.project[k];
        Object.assign(studio.project, T.migrate(project), { media });
        studio.project.nextId = Math.max(studio.project.nextId || 1, project.nextId || 1);
        studio.changed(clientId);
        return json(res, 200, { rev: studio.rev });
      }
      if (p === '/api/import' && req.method === 'POST') {
        const name = path.basename(url.searchParams.get('name') || `upload-${Date.now()}`).replace(/[^\w.\- ]+/g, '_');
        if (!(VIDEO_EXT.test(name) || AUDIO_EXT.test(name) || IMAGE_EXT.test(name))) return json(res, 400, { error: 'Unsupported file type' });
        let dest = path.join(studio.mediaDir, name);
        if (fs.existsSync(dest)) dest = path.join(studio.mediaDir, `${path.parse(name).name}-${crypto.randomBytes(3).toString('hex')}${path.extname(name)}`);
        await new Promise((resolve, reject) => { const w = fs.createWriteStream(dest); req.pipe(w); w.on('finish', resolve); w.on('error', reject); req.on('error', reject); });
        const m = await studio.ensureMedia(dest);
        return json(res, 200, { media: m });
      }
      if (p === '/api/import-path' && req.method === 'POST') {
        const { path: file } = await body(req);
        const m = await studio.ensureMedia(path.resolve(file));
        return json(res, 200, { media: m });
      }
      if (p === '/api/media/remove' && req.method === 'POST') {
        const { id } = await body(req);
        const m = studio.project.media.find((m) => m.id === id);
        if (m) {
          studio.project.media = studio.project.media.filter((x) => x !== m);
          studio.project.clips = studio.project.clips.filter((c) => c.src !== m.path);
          studio.project.audio = studio.project.audio.filter((a) => a.src !== m.path);
          studio.processing.delete(m.path);
          studio.changed();
        }
        return json(res, 200, { ok: true });
      }
      let m;
      if ((m = p.match(/^\/media\/(proxy|source|thumbs)\/(\w+)$/))) {
        const media = studio.project.media.find((x) => x.id === m[2]);
        if (!media) return json(res, 404, { error: 'no such media' });
        if (m[1] === 'thumbs') return media.thumbsPath ? sendFile(req, res, media.thumbsPath, 'image/jpeg') : json(res, 404, {});
        if (m[1] === 'proxy' && media.proxy) return sendFile(req, res, media.proxy, 'video/mp4');
        return sendFile(req, res, media.path);
      }
      if ((m = p.match(/^\/api\/peaks\/(\w+)$/))) {
        const media = studio.project.media.find((x) => x.id === m[1]);
        if (!media) return json(res, 404, {});
        const peaks = studio._peaks?.get(media.id) || (media.hasAudio ? await F.makePeaks(media.path, await F.probe(media.path)) : null);
        return json(res, 200, peaks || { perSec: 50, data: [] });
      }
      if ((m = p.match(/^\/exports\/([^/]+)$/))) return sendFile(req, res, path.join(studio.exportsDir, path.basename(decodeURIComponent(m[1]))));
      if (p === '/api/exports') return json(res, 200, fs.readdirSync(studio.exportsDir).filter((f) => f.endsWith('.mp4')).map((f) => ({ name: f, url: `/exports/${f}`, bytes: fs.statSync(path.join(studio.exportsDir, f)).size, mtime: fs.statSync(path.join(studio.exportsDir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime));
      if (p === '/api/export' && req.method === 'POST') {
        const opts = await body(req);
        studio.export(opts).catch((e) => studio.broadcast('render', { label: 'export', error: e.message }));
        return json(res, 202, { ok: true });
      }
      if ((m = p.match(/^\/api\/ops\/(silences|captions)$/)) && req.method === 'POST') {
        const opts = await body(req);
        if (!studio.project.clips.length) return json(res, 400, { error: 'The timeline is empty' });
        studio.broadcast('checkpoint', { project: structuredClone(studio.project), label: m[1] });
        studio.broadcast('task', { label: m[1] === 'silences' ? 'Removing silences…' : 'Transcribing speech…' });
        try {
          const r = m[1] === 'silences' ? await O.removeSilences(studio.project, opts) : await O.autoCaptions(studio.project, opts);
          studio.changed('ops');
          return json(res, 200, r);
        } finally { studio.broadcast('task', { label: null }); }
      }
      if (p === '/api/export/cancel' && req.method === 'POST') { studio.exportAbort?.abort(); return json(res, 200, { ok: true }); }
      if (p === '/api/agent' && req.method === 'POST') {
        const { message } = await body(req);
        studio.agent(message, { source: 'editor' }).catch(() => {});
        return json(res, 202, { ok: true });
      }
      if (p === '/api/agent/stop' && req.method === 'POST') { studio.agentAbort?.abort(); return json(res, 200, { ok: true }); }
      if (p === '/api/agent/reset' && req.method === 'POST') { studio.history = []; return json(res, 200, { ok: true }); }
      if (p === '/api/settings' && req.method === 'POST') {
        const { apiKey, model } = await body(req);
        if (apiKey !== undefined) studio.config.apiKey = apiKey || undefined;
        if (model) studio.config.model = model;
        studio.saveConfig();
        studio.broadcast('settings', studio.state().settings);
        return json(res, 200, studio.state().settings);
      }
      if (p === '/api/switch' && req.method === 'GET') return json(res, 200, studio.switch.status());
      if (p === '/api/switch/connect' && req.method === 'POST') {
        const opts = await body(req);
        await studio.switch.configure(opts);
        return json(res, 200, studio.switch.status());
      }
      if (p === '/api/switch/share' && req.method === 'POST') {
        const r = studio.lastExport;
        if (!r) return json(res, 400, { error: 'Export something first' });
        await studio.switch.share(r.output, `🎞 ${studio.project.name} · ${r.duration}s · ${r.resolution} (shared from Weave Studio)`);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/switch/disconnect' && req.method === 'POST') { studio.switch.stop(); studio.config.switch = { ...studio.config.switch, enabled: false }; studio.saveConfig(); return json(res, 200, studio.switch.status()); }

      // Static UI
      if (req.method === 'GET') {
        const file = path.join(WEB, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
        if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      log(`error ${req.method} ${p}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { error: e.message });
    }
  });
  server.requestTimeout = 0; // large uploads
  return new Promise((resolve) => server.listen(port, host, () => {
    if (studio.config.switch?.enabled) studio.switch.start().catch((e) => log(`[switch] ${e.message}`));
    resolve({ server, studio, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}` });
  }));
}
