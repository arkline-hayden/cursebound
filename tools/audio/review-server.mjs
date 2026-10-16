#!/usr/bin/env node
// Sound review page (http://localhost:4321): every sound in tools/audio/sounds.mjs with its set of generated takes
// (tools/audio/candidates/<sound>/1-4.mp3). Pick the take the game should use (or several, for sounds with
// variations); a pick is copied into the game at once. Mark a set to regenerate (+ a note that steers the prompt):
// tools/audio/rerolls.json, consumed by `node tools/audio/generate.mjs --rerolls`.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUB, folderFor, here, installPicks, readPicks, root, setDir, writePicks } from './picks.mjs';

const REROLLS = path.join(here, 'rerolls.json');
// when you last picked a take of each sound: a set generated after that is badged NEW
const REVIEWED = path.join(here, 'reviewed.json');
const readReviewed = () => (fs.existsSync(REVIEWED) ? JSON.parse(fs.readFileSync(REVIEWED, 'utf8')) : {});
const PORT = Number(process.env.AUDIO_REVIEW_PORT ?? 4321);
const soundsUrl = pathToFileURL(path.join(here, 'sounds.mjs')).href;
const sounds = async () => import(`${soundsUrl}?t=${Date.now()}`);   // fresh each time: list edits show without a restart
const readRerolls = () => (fs.existsSync(REROLLS) ? JSON.parse(fs.readFileSync(REROLLS, 'utf8')) : {});
const ver = (p) => Math.round(fs.statSync(p).mtimeMs);

async function state() {
  const { SECTIONS, STYLE } = await sounds();
  const picks = readPicks();
  const reviewed = readReviewed();
  return {
    rerolls: readRerolls(),
    sections: SECTIONS.map((s) => ({ key: s.key, title: s.title, blurb: s.blurb, items: s.items.map((i) => {
      const dir = setDir(i.file);
      const takes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+\.mp3$/.test(f)).map((f) => Number(f.slice(0, -4))).sort((a, b) => a - b) : [];
      // files already in the game without a set (made by hand)
      const gdir = path.join(PUB, folderFor(i));
      const game = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter((f) => f === `${i.file}.mp3` || new RegExp(`^${i.file}_\\d{2}\\.mp3$`).test(f)).sort() : [];
      return {
        file: i.file, when: i.when, base: i.prompt, prompt: `${i.prompt}, ${STYLE[i.kind]}`, tier: i.tier, seconds: i.seconds, loop: i.loop, tool: i.tool, variants: i.variants,
        takes: takes.map((n) => ({ n, url: `/take/${i.file}/${n}.mp3?v=${ver(path.join(dir, `${n}.mp3`))}` })),
        picked: picks[i.file] ?? [],
        fresh: takes.length > 0 && ver(path.join(dir, `${takes[0]}.mp3`)) > (reviewed[i.file] ?? 0),
        game: takes.length ? [] : game.map((f) => ({ name: f, url: `/game/${folderFor(i)}/${f}?v=${ver(path.join(gdir, f))}` })),
      };
    }) })),
  };
}

const body = async (req) => { let b = ''; for await (const c of req) b += c; return JSON.parse(b || '{}'); };
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const audio = (res, p) => { if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' }); fs.createReadStream(p).pipe(res); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(here, 'review.html'), 'utf8')); return; }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, await state());
    if (req.method === 'POST' && url.pathname === '/api/rerolls') { fs.writeFileSync(REROLLS, JSON.stringify(await body(req), null, 1)); return json(res, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/pick') {
      // { file, takes: [n, ...] }: install these takes into the game
      const { file, takes } = await body(req);
      const { SECTIONS } = await sounds();
      const i = SECTIONS.flatMap((s) => s.items).find((x) => x.file === file);
      if (!i || !Array.isArray(takes) || !takes.length) return json(res, { ok: false });
      const picks = readPicks();
      picks[file] = takes.map(Number).filter((n) => n > 0);
      writePicks(picks);
      const reviewed = readReviewed();
      reviewed[file] = Date.now();
      fs.writeFileSync(REVIEWED, JSON.stringify(reviewed, null, 1));
      const names = installPicks(i, picks[file]);
      await import(`${pathToFileURL(path.join(root, 'scripts/audio-manifest.mjs')).href}?t=${Date.now()}`);
      return json(res, { ok: true, names });
    }
    let m = /^\/take\/([a-z0-9_]+)\/(\d+\.mp3)$/.exec(url.pathname);
    if (req.method === 'GET' && m) return audio(res, path.join(setDir(m[1]), m[2]));
    m = /^\/game\/(sfx|amb|stingers|music)\/([a-z0-9_]+\.mp3)$/.exec(url.pathname);
    if (req.method === 'GET' && m) return audio(res, path.join(PUB, m[1], m[2]));
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[audio] review page at http://localhost:${PORT}`));
