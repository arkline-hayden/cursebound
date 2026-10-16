#!/usr/bin/env node
// Generates the game's recorded audio with ElevenLabs from tools/audio/sounds.mjs (the sound list).
// Every sound gets a SET of 4 takes (tools/audio/candidates/<sound>/1-4.mp3). The game uses the picked take(s):
// one for a single sound, several for sounds with variations (footsteps, hits). Until you pick in the review page,
// the first take(s) are installed so the game has the sound right away.
//   node tools/audio/generate.mjs --tier 1              sounds of tier 1 that have no set yet
//   node tools/audio/generate.mjs --only ui_click,dodge  new sets for these sounds
//   node tools/audio/generate.mjs --rerolls             new sets for everything marked in the review page
//   --dry lists the work, --music includes music tracks (skipped by default), --takes N changes the set size
// The API key comes from ELEVENLABS_API_KEY (environment, or the git-ignored .env at the repo root); never printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installPicks, setDir, readPicks, writePicks, root, here, PUB, folderFor } from './picks.mjs';

const { SECTIONS, STYLE } = await import(pathToFileURL(path.join(here, 'sounds.mjs')).href);
const LOG = path.join(here, 'log.json');
const REROLLS = path.join(here, 'rerolls.json');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
let KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY && fs.existsSync(path.join(root, '.env'))) KEY = /^ELEVENLABS_API_KEY=(.+)$/m.exec(fs.readFileSync(path.join(root, '.env'), 'utf8'))?.[1]?.trim();
const dry = flag('dry');
if (!KEY && !dry) { console.error('No ELEVENLABS_API_KEY (environment or .env).'); process.exit(1); }
const TAKES = Number(opt('takes') ?? 4);

const all = SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.key })));
const rerolls = fs.existsSync(REROLLS) ? JSON.parse(fs.readFileSync(REROLLS, 'utf8')) : {};
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : {};

// ---- pick the sounds to make a set for
const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const tier = opt('tier') ? Number(opt('tier')) : null;
const todo = [];
for (const i of all) {
  if (i.tool === 'music' && !flag('music') && !only?.includes(i.file)) continue;
  if (flag('rerolls')) { if (rerolls[i.file]) todo.push({ i, note: rerolls[i.file].note ?? '' }); continue; }
  if (only) { if (only.includes(i.file)) todo.push({ i, note: '' }); continue; }
  if (tier !== null && i.tier !== tier) continue;
  // already has a set, or files you made yourself in the game: leave it (use --only to redo one)
  const inGame = fs.existsSync(path.join(PUB, folderFor(i))) && fs.readdirSync(path.join(PUB, folderFor(i))).some((f) => f === `${i.file}.mp3` || new RegExp(`^${i.file}_\\d{2}\\.mp3$`).test(f));
  if (!fs.existsSync(path.join(setDir(i.file), '1.mp3')) && !inGame) todo.push({ i, note: '' });
}

const promptFor = (j) => `${j.i.prompt}${j.note ? `, ${j.note}` : ''}, ${STYLE[j.i.kind]}`;
const secs = todo.filter((j) => j.i.tool !== 'music').reduce((n, j) => n + j.i.seconds * TAKES, 0);
console.log(`[audio] ${todo.length} sets of ${TAKES} takes (${Math.round(secs)} s of sound effects${todo.some((j) => j.i.tool === 'music') ? `, ${todo.filter((j) => j.i.tool === 'music').length} music tracks` : ''})`);
if (dry) { for (const j of todo) console.log(`  ${j.i.file}  ${j.i.seconds}s${j.i.loop ? ' loop' : ''}${j.note ? `  note: ${j.note}` : ''}`); process.exit(0); }

// ---- ElevenLabs
async function call(url, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const text = (await res.text()).slice(0, 400);
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  throw new Error('gave up after retries');
}
const take = (j) => j.i.tool === 'music'
  ? call('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { prompt: promptFor(j), music_length_ms: Math.round(j.i.seconds * 1000), force_instrumental: true })
  : call('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { text: promptFor(j), duration_seconds: Math.min(22, Math.max(0.5, j.i.seconds)), prompt_influence: 0.6, ...(j.i.loop ? { loop: true } : {}) });

const picks = readPicks();
let made = 0, failed = 0, stop = false;
const finished = new Set();
const saveLog = () => fs.writeFileSync(LOG, JSON.stringify(log, null, 1));

// work queue of single takes so several sets fill in parallel; a set is installed once all its takes are in
const queue = todo.flatMap((j) => Array.from({ length: TAKES }, (_, n) => ({ j, n: n + 1 })));
const pending = new Map(todo.map((j) => [j.i.file, { j, left: TAKES, got: [] }]));
for (const j of todo) { const d = setDir(j.i.file); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

async function worker() {
  while (queue.length && !stop) {
    const { j, n } = queue.shift();
    const p = pending.get(j.i.file);
    try {
      const buf = await take(j);
      fs.writeFileSync(path.join(setDir(j.i.file), `${n}.mp3`), buf);
      p.got.push(n);
      made++;
    } catch (e) {
      failed++;
      const msg = String(e.message || e);
      console.log(`  ERR ${j.i.file} take ${n}: ${msg}`);
      if (/HTTP 40[12]|quota|credit|insufficient|invalid_api_key|unauthorized/i.test(msg)) { stop = true; console.log('  stopping: check the API key or remaining credits'); }
    }
    if (--p.left === 0 && p.got.length) {
      p.got.sort((a, b) => a - b);
      // a fresh set starts on its first take(s) until you choose in the review page
      picks[j.i.file] = p.got.slice(0, Math.min(j.i.variants, p.got.length));
      installPicks(j.i, picks[j.i.file]);
      (log[j.i.file] ??= []).push({ prompt: promptFor(j), seconds: j.i.seconds, loop: j.i.loop, takes: p.got.length, at: new Date().toISOString() });
      finished.add(j.i.file);
      console.log(`  ok  ${j.i.file} (${p.got.length} takes)`);
      if (finished.size % 5 === 0) { writePicks(picks); saveLog(); }
    }
  }
}
await Promise.all(Array.from({ length: Number(opt('jobs') ?? 4) }, worker));
writePicks(picks);
saveLog();
await import(pathToFileURL(path.join(root, 'scripts/audio-manifest.mjs')).href);
if (flag('rerolls')) { for (const k of finished) delete rerolls[k]; fs.writeFileSync(REROLLS, JSON.stringify(rerolls, null, 1)); }
console.log(`[audio] ${finished.size} sets done (${made} takes), ${failed} failed${stop ? ', stopped early' : ''}`);
