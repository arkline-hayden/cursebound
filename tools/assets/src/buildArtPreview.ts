/**
 * Compiles the framework-free procedural art/audio modules to browser ES modules for the developer
 * art viewer at apps/client/public/art-preview.html.
 *
 *   npx tsx tools/assets/src/buildArtPreview.ts            # build once
 *   npx tsx tools/assets/src/buildArtPreview.ts --serve    # build + serve apps/client/public on :3999
 *
 * Output goes to apps/client/public/art-preview/ (generated; safe to delete).
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const srcRoot = join(root, 'apps/client/src');
const publicDir = join(root, 'apps/client/public');
const outRoot = join(publicDir, 'art-preview');

/** Directories / files compiled for the viewer. Phaser-dependent modules are excluded. */
const INCLUDE = ['game/art', 'game/audio', 'ui/icons/iconData.ts'];
const EXCLUDE = new Set(['game/art/generate.ts', 'game/art/dungeon.ts', 'game/art/texutil.ts']);

function walk(p: string, acc: string[]): void {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) walk(join(p, f), acc);
  } else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) {
    acc.push(p);
  }
}

function rewriteImports(code: string): string {
  return code.replace(/(from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, pre: string, q: string, spec: string) => {
    const withExt = extname(spec) ? spec : `${spec}.js`;
    return `${pre}${q}${withExt}${q}`;
  });
}

export function build(): number {
  const files: string[] = [];
  for (const inc of INCLUDE) {
    const p = join(srcRoot, inc);
    if (existsSync(p)) walk(p, files);
  }
  if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
  let count = 0;
  for (const f of files) {
    const rel = relative(srcRoot, f).split(sep).join('/');
    if (EXCLUDE.has(rel)) continue;
    const src = readFileSync(f, 'utf8');
    const out = ts.transpileModule(src, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: false,
        isolatedModules: true,
      },
      fileName: f,
    });
    const dest = join(outRoot, rel.replace(/\.ts$/, '.js'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, rewriteImports(out.outputText));
    count++;
  }
  return count;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serve(port: number): void {
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/art-preview.html';
    const file = resolve(publicDir, `.${p}`);
    if (!file.startsWith(publicDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    // rebuild on every page load so edits show up on refresh
    if (p === '/art-preview.html') {
      build();
      void writeIconContent();
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  }).listen(port, '127.0.0.1', () => {
    console.log(`art preview: http://127.0.0.1:${port}/art-preview.html`);
  });
}

/** Minimal content snapshot for the viewer's data-driven icons (nodes, skills, classes, cards, families). */
export async function writeIconContent(): Promise<boolean> {
  try {
    const spec = '@cursebound/content';
    const C = (await import(spec)) as Record<string, unknown> & {
      NODES: { id: string; classId: string; branch: string; name: string; tier: number; excludes?: string[]; modifiers: unknown[]; grantsSkill?: string; mechanics: string[] }[];
      SKILLS: { id: string; classId: string; name: string; damageType: string; shape: { kind: string } }[];
      CLASSES: { id: string; accent: string; branches: { id: string; name: string; theme: string }[] }[];
      CARDS: { id: string; name: string; family: string; rarity?: string }[];
      TUTORIAL_CARD?: { id: string; name: string; family: string; rarity?: string };
      FAMILIES: Record<string, { name: string; color: string }>;
    };
    const snap = {
      nodes: C.NODES.map((n) => ({ id: n.id, classId: n.classId, branch: n.branch, name: n.name, tier: n.tier, excludes: n.excludes ?? [], modifiers: n.modifiers.map(() => 0), grantsSkill: n.grantsSkill, mechanics: n.mechanics })),
      skills: C.SKILLS.map((k) => ({ id: k.id, classId: k.classId, name: k.name, damageType: k.damageType, shape: { kind: k.shape.kind } })),
      classes: C.CLASSES.map((k) => ({ id: k.id, accent: k.accent, branches: k.branches })),
      cards: [...C.CARDS, ...(C.TUTORIAL_CARD ? [C.TUTORIAL_CARD] : [])].map((k) => ({ id: k.id, name: k.name, family: k.family, rarity: k.rarity })),
      families: C.FAMILIES,
    };
    mkdirSync(outRoot, { recursive: true });
    writeFileSync(join(outRoot, 'iconContent.json'), JSON.stringify(snap));
    return true;
  } catch (err) {
    console.warn(`[art-preview] content snapshot skipped (${(err as Error).message})`);
    return false;
  }
}

const n = build();
console.log(`compiled ${n} modules -> ${relative(root, outRoot)}`);
if (await writeIconContent()) console.log('wrote icon content snapshot');
if (process.argv.includes('--serve')) serve(Number(process.env.PORT ?? 3999));
