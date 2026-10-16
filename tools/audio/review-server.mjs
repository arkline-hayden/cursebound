#!/usr/bin/env node
// Sound review page: lists every sound in tools/audio/sounds.mjs, plays its takes straight from
// apps/client/public/audio, and saves re-roll marks (+ notes that steer the prompt) to tools/audio/rerolls.json,
// which `node tools/audio/generate.mjs --rerolls` consumes.   node tools/audio/review-server.mjs  ->  http://localhost:4321
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PUB = path.join(root, 'apps/client/public/audio');
const REROLLS = path.join(here, 'rerolls.json');
const PORT = Number(process.env.AUDIO_REVIEW_PORT ?? 4321);
const soundsUrl = pathToFileURL(path.join(here, 'sounds.mjs')).href;

const folderFor = (i) => (i.tool === 'music' ? 'music' : i.kind === 'amb' ? 'amb' : i.kind === 'sting' ? 'stingers' : 'sfx');
const namesFor = (i) => (i.variants > 1 ? Array.from({ length: i.variants }, (_, n) => `${i.file}_${String(n + 1).padStart(2, '0')}.mp3`) : [`${i.file}.mp3`]);

async function state() {
  // re-import each time so edits to the sound list show up without a restart
  const { SECTIONS, STYLE } = await import(`${soundsUrl}?t=${Date.now()}`);
  const rerolls = fs.existsSync(REROLLS) ? JSON.parse(fs.readFileSync(REROLLS, 'utf8')) : {};
  return {
    rerolls,
    sections: SECTIONS.map((s) => ({ key: s.key, title: s.title, blurb: s.blurb, items: s.items.map((i) => {
      const folder = folderFor(i);
      return {
        file: i.file, when: i.when, prompt: `${i.prompt}, ${STYLE[i.kind]}`, base: i.prompt, tier: i.tier, seconds: i.seconds, loop: i.loop, tool: i.tool,
        takes: namesFor(i).map((n) => { const p = path.join(PUB, folder, n); const st = fs.existsSync(p) ? fs.statSync(p) : null; return { name: n, url: st ? `/audio/${folder}/${n}?v=${Math.round(st.mtimeMs)}` : null }; }),
      };
    }) })),
  };
}

const page = fs.readFileSync(path.join(here, 'review.html'), 'utf8');
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return; }
    if (req.method === 'GET' && url.pathname === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(await state())); return; }
    if (req.method === 'POST' && url.pathname === '/api/rerolls') {
      let body = '';
      for await (const c of req) body += c;
      const data = JSON.parse(body || '{}');
      fs.writeFileSync(REROLLS, JSON.stringify(data, null, 1));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    const m = /^\/audio\/(sfx|amb|stingers|music)\/([a-z0-9_]+\.mp3)$/.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const p = path.join(PUB, m[1], m[2]);
      if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' });
      fs.createReadStream(p).pipe(res); return;
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[audio] review page at http://localhost:${PORT}`));
