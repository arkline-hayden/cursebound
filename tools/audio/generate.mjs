#!/usr/bin/env node
// Generates the game's recorded audio with ElevenLabs from tools/audio/sounds.mjs (the sound list).
//   node tools/audio/generate.mjs --tier 1            all missing tier-1 files
//   node tools/audio/generate.mjs --only ui_click,dodge   these sounds (regenerates even if present)
//   node tools/audio/generate.mjs --rerolls            everything marked in the review page (tools/audio/rerolls.json)
//   add --dry to list what would be made, --music to include music tracks (skipped by default: they cost the most)
// The API key comes from the ELEVENLABS_API_KEY environment variable and is never printed or written anywhere.
// Sound effects -> apps/client/public/audio/sfx, ambience -> /amb, stingers -> /stingers, music -> /music.
// Every take made is recorded in tools/audio/log.json (prompt, settings, time) so re-rolls can be tracked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const { SECTIONS, STYLE } = await import(pathToFileURL(path.join(here, 'sounds.mjs')).href);
const PUB = path.join(root, 'apps/client/public/audio');
const LOG = path.join(here, 'log.json');
const REROLLS = path.join(here, 'rerolls.json');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const KEY = process.env.ELEVENLABS_API_KEY;
const dry = flag('dry');
if (!KEY && !dry) { console.error('ELEVENLABS_API_KEY is not set (setx ELEVENLABS_API_KEY "..." then restart the terminal).'); process.exit(1); }

export const folderFor = (i) => (i.tool === 'music' ? 'music' : i.kind === 'amb' ? 'amb' : i.kind === 'sting' ? 'stingers' : 'sfx');
export const namesFor = (i) => (i.variants > 1 ? Array.from({ length: i.variants }, (_, n) => `${i.file}_${String(n + 1).padStart(2, '0')}.mp3`) : [`${i.file}.mp3`]);

const all = SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.key })));
const rerolls = fs.existsSync(REROLLS) ? JSON.parse(fs.readFileSync(REROLLS, 'utf8')) : {};
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : {};

// ---- pick the jobs: one job per output file
const jobs = [];
const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const tier = opt('tier') ? Number(opt('tier')) : null;
for (const i of all) {
  if (i.tool === 'music' && !flag('music') && !only?.includes(i.file)) continue;
  const names = namesFor(i);
  const dir = path.join(PUB, folderFor(i));
  if (flag('rerolls')) {
    const r = rerolls[i.file];
    if (!r) continue;
    // a re-roll names specific takes (or all of them) and may carry a note that steers the prompt
    const which = r.takes?.length ? names.filter((n) => r.takes.includes(n)) : names;
    for (const n of which) jobs.push({ i, name: n, dir, note: r.note ?? '' });
  } else if (only) {
    if (!only.includes(i.file)) continue;
    for (const n of names) jobs.push({ i, name: n, dir, note: '' });
  } else {
    if (tier !== null && i.tier !== tier) continue;
    for (const n of names) if (!fs.existsSync(path.join(dir, n))) jobs.push({ i, name: n, dir, note: '' });
  }
}

const promptFor = (j) => `${j.i.prompt}${j.note ? `, ${j.note}` : ''}, ${STYLE[j.i.kind]}`;
const secs = jobs.filter((j) => j.i.tool !== 'music').reduce((n, j) => n + j.i.seconds, 0);
console.log(`[audio] ${jobs.length} files to make (${Math.round(secs)} s of sound effects${jobs.some((j) => j.i.tool === 'music') ? ` + ${jobs.filter((j) => j.i.tool === 'music').length} music tracks` : ''})`);
if (dry) { for (const j of jobs) console.log(`  ${folderFor(j.i)}/${j.name}  ${j.i.seconds}s${j.i.loop ? ' loop' : ''}  ${promptFor(j).slice(0, 90)}…`); process.exit(0); }

// ---- ElevenLabs calls
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
const sfx = (j) => call('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
  text: promptFor(j), duration_seconds: Math.min(22, Math.max(0.5, j.i.seconds)), prompt_influence: 0.6, ...(j.i.loop ? { loop: true } : {}),
});
const music = (j) => call('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
  prompt: promptFor(j), music_length_ms: Math.round(j.i.seconds * 1000), force_instrumental: true,
});

let done = 0, failed = 0, stop = false;
const made = new Set();
const save = () => fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
async function worker() {
  while (jobs.length && !stop) {
    const j = jobs.shift();
    try {
      const buf = await (j.i.tool === 'music' ? music(j) : sfx(j));
      fs.mkdirSync(j.dir, { recursive: true });
      fs.writeFileSync(path.join(j.dir, j.name), buf);
      (log[j.i.file] ??= []).push({ take: j.name, prompt: promptFor(j), seconds: j.i.seconds, loop: j.i.loop, at: new Date().toISOString() });
      done++;
      made.add(j.i.file);
      if (done % 10 === 0) save();
      console.log(`  ok  ${folderFor(j.i)}/${j.name}`);
    } catch (e) {
      failed++;
      const msg = String(e.message || e);
      console.log(`  ERR ${j.name}: ${msg}`);
      // out of credits / bad key: stop instead of failing every remaining job
      if (/401|402|quota|credit|insufficient|invalid_api_key/i.test(msg)) { stop = true; console.log('  stopping: check the API key or remaining credits'); }
    }
  }
}
await Promise.all(Array.from({ length: Number(opt('jobs') ?? 3) }, worker));
save();
// files for the game: refresh the manifest the audio engine reads
await import(pathToFileURL(path.join(root, 'scripts/audio-manifest.mjs')).href);
console.log(`[audio] made ${done}, failed ${failed}${stop ? ', stopped early' : ''}`);
if (flag('rerolls') && !stop) {
  // clear the re-rolls that were made
  for (const k of made) delete rerolls[k];
  fs.writeFileSync(REROLLS, JSON.stringify(rerolls, null, 1));
}
