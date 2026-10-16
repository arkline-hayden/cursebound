// Shared by the generator and the review server: where a sound's take set lives, which takes are picked, and
// installing the picks into the game (apps/client/public/audio/<folder>/<name>.mp3, or _01.._NN for variations).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const PUB = path.join(root, 'apps/client/public/audio');
const PICKS = path.join(here, 'picks.json');

export const folderFor = (i) => (i.tool === 'music' ? 'music' : i.kind === 'amb' ? 'amb' : i.kind === 'sting' ? 'stingers' : 'sfx');
export const setDir = (file) => path.join(here, 'candidates', file);
export const readPicks = () => (fs.existsSync(PICKS) ? JSON.parse(fs.readFileSync(PICKS, 'utf8')) : {});
export const writePicks = (p) => fs.writeFileSync(PICKS, JSON.stringify(p, null, 1));

/** Copy the picked takes of a sound into the game, replacing whatever it had. */
export function installPicks(i, takes) {
  const dir = path.join(PUB, folderFor(i));
  fs.mkdirSync(dir, { recursive: true });
  // clear the sound's old files (single and numbered variations)
  const re = new RegExp(`^${i.file}(_\\d{2})?\\.mp3$`);
  for (const f of fs.readdirSync(dir)) if (re.test(f)) fs.rmSync(path.join(dir, f));
  const list = takes.filter((n) => fs.existsSync(path.join(setDir(i.file), `${n}.mp3`)));
  if (!list.length) return [];
  const multi = i.variants > 1;
  const names = list.map((n, k) => (multi ? `${i.file}_${String(k + 1).padStart(2, '0')}.mp3` : `${i.file}.mp3`));
  (multi ? list : list.slice(0, 1)).forEach((n, k) => fs.copyFileSync(path.join(setDir(i.file), `${n}.mp3`), path.join(dir, names[k])));
  return multi ? names : names.slice(0, 1);
}
