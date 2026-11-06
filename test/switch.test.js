// Drives the Switch bridge against a mock Switch server that speaks the Agent Protocol
// (registration, WebSocket events with ping/pong, message + media routes). No network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Studio } from '../src/server.js';

const REG_KEY = 'reg-secret', AGENT_KEY = 'agent-secret', AGENT_ID = 'agt_123', ROOM = '!room:switch';

// ---- tiny WebSocket server (RFC 6455, text frames only) ----
function wsAccept(req, socket) {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const send = (obj) => {
    const data = Buffer.from(JSON.stringify(obj));
    const head = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
    socket.write(Buffer.concat([head, data]));
  };
  const listeners = [];
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 6) {
      const op = buf[0] & 15;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]);
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { socket.end(); return; }
      if (op === 1) listeners.forEach((f) => f(JSON.parse(payload.toString())));
    }
  });
  return { send, onMessage: (f) => listeners.push(f) };
}

function mockSwitch() {
  const log = { registered: null, addressing: null, messages: [], uploads: [], typing: 0, pongs: [], wsQuery: null };
  let ws;
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const ok = (d) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (req.method === 'POST' && url.pathname === '/agents') {
        assert.equal(auth, `Bearer ${REG_KEY}`);
        log.registered = JSON.parse(body);
        return ok({ id: AGENT_ID, api_key: AGENT_KEY });
      }
      if (auth !== `Bearer ${AGENT_KEY}`) { res.writeHead(401); return res.end('bad key'); }
      if (url.pathname === `/agents/${AGENT_ID}/ops/update_agent_detail`) { log.addressing = JSON.parse(body).addressing; return ok({ result: {} }); }
      if (url.pathname === `/agents/${AGENT_ID}/message`) { log.messages.push(JSON.parse(body)); return ok({ ok: true, event_id: 'e1' }); }
      if (url.pathname === `/agents/${AGENT_ID}/typing`) { log.typing++; return ok({ ok: true }); }
      if (url.pathname === `/agents/${AGENT_ID}/rooms/${encodeURIComponent(ROOM)}/media` && req.method === 'POST') {
        log.uploads.push({ type: req.headers['content-type'], size: body.length, hasMp4: body.includes(Buffer.from('ftyp')), caption: /name="caption"\r\n\r\n([^\r]*)/.exec(body.toString('latin1'))?.[1] });
        return ok({ ok: true });
      }
      if (url.pathname === `/agents/${AGENT_ID}/rooms/${encodeURIComponent(ROOM)}/media` && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        return res.end(fs.readFileSync(log.fixture));
      }
      res.writeHead(404); res.end();
    });
  });
  server.on('upgrade', (req, socket) => {
    assert.equal(req.headers.authorization, `Bearer ${AGENT_KEY}`);
    log.wsQuery = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    ws = wsAccept(req, socket);
    ws.onMessage((m) => { if (m.type === 'pong') log.pongs.push(m.cursor); });
    ws.send({ event: 'connection_state', data: { connection_id: log.wsQuery.connection_id, generation: 1, rooms: [ROOM], cursor: 0, protocol: 9 } });
  });
  let seq = 0;
  const say = (body, extra = {}) => ws.send({ event: 'message', id: ++seq, data: { type: 'message', room_id: ROOM, channel_type: 'channel_public', sequence: seq, payload: { addressed: true, sender: '@pat:x', sender_name: 'Pat', message_id: `m${seq}`, body, timestamp: Date.now(), thread_id: null, attachments: [], ...extra } } });
  return { server, log, say, ping: () => ws.send({ event: 'ping' }), unaddressed: (body) => ws.send({ event: 'message', id: ++seq, data: { type: 'message', room_id: ROOM, payload: { addressed: false, body, sender_name: 'Sam' } } }) };
}

const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };

test('Switch bridge: register, receive footage, edit, preview, approve, export to chat', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-switch-'));
  const fixture = path.join(dir, 'fixture.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=d=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture]);
  const mock = mockSwitch();
  mock.log.fixture = fixture;
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${mock.server.address().port}`;

  const studio = new Studio(path.join(dir, 'studio'), { log: () => {} });
  // Stand-in for Claude: a deterministic "agent" that edits the timeline and renders a preview.
  const seen = [];
  studio.agent = async (instruction, { who, source, hooks, extraContext }) => {
    seen.push({ instruction, who, source, extraContext });
    const m = studio.project.media[0];
    studio.project.clips.push({ id: 'c1', src: m.path, start: 0, end: 2, speed: 1, volume: 1, hasAudio: true, fadeIn: 0, fadeOut: 0, transition: null, flip: false, color: { look: 'bw' } });
    const r = await studio.export({ preview: true });
    await hooks.onRendered(r);
    return 'Trimmed to 2s and graded black & white.';
  };

  await studio.switch.configure({ url, registrationKey: REG_KEY, name: 'weave', addressing: 'anyone' });
  assert.equal(mock.log.registered.name, 'weave');
  assert.equal(mock.log.registered.integration_profile.connection_model, 'always_on');
  assert.equal(mock.log.addressing, 'anyone');
  await until(() => studio.switch.connected);
  assert.equal(mock.log.wsQuery.filter, 'addressed');
  assert.deepEqual(studio.switch.rooms, [ROOM]);
  const saved = JSON.parse(fs.readFileSync(studio.cfgFile, 'utf8'));
  assert.equal(saved.switch.apiKey, AGENT_KEY);

  // heartbeat
  mock.ping();
  await until(() => mock.log.pongs.length);

  // unaddressed chatter is ignored
  mock.unaddressed('lunch?');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(seen.length, 0);

  // footage + instruction from chat
  mock.say('@weave make it black and white, keep the first 2 seconds', { attachments: [{ filename: 'clip.mp4', mimetype: 'video/mp4', size: 1000, mxc: 'mxc://switch/abc', msgtype: 'm.video' }] });
  await until(() => mock.log.uploads.length === 1);
  assert.equal(seen[0].who, 'Pat');
  assert.equal(seen[0].source, 'switch');
  assert.match(seen[0].instruction, /black and white/);
  assert.match(seen[0].extraContext, /clip\.mp4/);
  assert.equal(studio.project.media[0].name, 'clip.mp4');
  assert.ok(mock.log.uploads[0].hasMp4 && /multipart\/form-data/.test(mock.log.uploads[0].type));
  assert.match(mock.log.uploads[0].caption, /Preview/);
  await until(() => mock.log.messages.some((m) => /approve/i.test(m.content)));

  // status command
  mock.say('status');
  await until(() => mock.log.messages.some((m) => /1 clip/.test(m.content)));

  // human approval → full export posted to the room
  mock.say('approve');
  await until(() => mock.log.uploads.length === 2, 60000);
  assert.match(mock.log.uploads[1].caption, /Final export/);
  assert.ok(mock.log.messages.some((m) => /Approved by Pat/.test(m.content)));
  assert.ok(mock.log.typing >= 2);

  studio.switch.stop();
  mock.server.closeAllConnections?.();
  mock.server.close();
});
