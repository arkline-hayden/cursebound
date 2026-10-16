#!/usr/bin/env node
// Checks that the game's installed sound files are exactly the takes picked in the review page.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUB, folderFor, here, readPicks, setDir } from './picks.mjs';

const { SECTIONS } = await import(pathToFileURL(path.join(here, 'sounds.mjs')).href);
const picks = readPicks();
let ok = 0;
const bad = [];
for (const i of SECTIONS.flatMap((s) => s.items)) {
  const p = picks[i.file];
  if (!p?.length) continue;
  const names = i.variants > 1 ? p.map((_, k) => `${i.file}_${String(k + 1).padStart(2, '0')}.mp3`) : [`${i.file}.mp3`];
  names.forEach((n, k) => {
    const game = path.join(PUB, folderFor(i), n);
    const take = path.join(setDir(i.file), `${p[k]}.mp3`);
    if (fs.existsSync(game) && fs.existsSync(take) && fs.readFileSync(game).equals(fs.readFileSync(take))) ok++;
    else bad.push(n);
  });
}
console.log(`[audio] ${ok} installed files match your picks; mismatched: ${bad.join(' ') || 'none'}`);
process.exit(bad.length ? 1 : 0);
