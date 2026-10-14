/**
 * Asset manifest validator (PRD §15.3): rejects missing animation states, missing card/node icons,
 * duplicate IDs and missing effects. Cross-checks the content package's card/node/skill icon refs and
 * builds every theme's isometric terrain to verify the iso texture contract.
 *
 *   npx tsx tools/assets/src/validate.ts        (exit 1 on problems)
 *
 * Node only: no Phaser, no DOM.
 */
import * as manifestNs from '../../../apps/client/src/game/art/manifest';

// apps/client is not an ESM package, so under tsx the module may arrive as a CJS namespace (exports on .default).
type ManifestModule = typeof manifestNs;
const { ASSET_MANIFEST, validateManifest } = ((manifestNs as unknown as { default?: ManifestModule }).default ?? manifestNs) as ManifestModule;
import * as isoNs from '../../../apps/client/src/game/art/isoTerrain';
type IsoModule = typeof isoNs;
const { validateIso } = ((isoNs as unknown as { default?: IsoModule }).default ?? isoNs) as IsoModule;

type IconContent = NonNullable<NonNullable<Parameters<typeof validateManifest>[0]>['iconContent']>;

interface ContentLike {
  CARDS?: { id: string; icon?: string }[];
  TUTORIAL_CARD?: { id: string; icon?: string };
  NODES?: { id: string; icon?: string }[];
  SKILLS?: { id: string; icon?: string }[];
  CLASSES?: unknown[];
  FAMILIES?: Record<string, { name: string; color: string }>;
  MECHANICS?: { id: string; kind: string; color: string; name: string; icon?: string }[];
  MASTERY_CHOICES?: readonly { id: string }[];
}

async function loadContent(): Promise<ContentLike | null> {
  try {
    const spec = '@cursebound/content';
    return (await import(spec)) as ContentLike;
  } catch (err) {
    console.warn(`[assets] content package not loadable, validating art catalog only (${(err as Error).message})`);
    return null;
  }
}

function iconRef(ref: string | undefined, kind: 'card' | 'node'): string | null {
  if (!ref) return null;
  const [k, id] = ref.split(':');
  return k === kind && id ? id : null;
}

async function main(): Promise<void> {
  const content = await loadContent();
  const cardIds: string[] = [];
  const nodeIds: string[] = [];
  if (content) {
    for (const c of content.CARDS ?? []) cardIds.push(iconRef(c.icon, 'card') ?? c.id);
    if (content.TUTORIAL_CARD) cardIds.push(iconRef(content.TUTORIAL_CARD.icon, 'card') ?? content.TUTORIAL_CARD.id);
    for (const n of content.NODES ?? []) nodeIds.push(iconRef(n.icon, 'node') ?? n.id);
    for (const s of content.SKILLS ?? []) {
      const id = iconRef(s.icon, 'node');
      if (id) nodeIds.push(id);
    }
    for (const m of content.MASTERY_CHOICES ?? []) nodeIds.push(m.id);
    nodeIds.push('dodge');
  }
  // content-driven icons: register the content so node / card / skill icons can be derived from data
  const iconContent = content
    ? ({
        nodes: content.NODES,
        skills: content.SKILLS,
        classes: content.CLASSES,
        cards: [...(content.CARDS ?? []), ...(content.TUTORIAL_CARD ? [content.TUTORIAL_CARD] : [])],
        families: content.FAMILIES,
      } as unknown as IconContent)
    : undefined;
  const problems = validateManifest({ cardIds, nodeIds, iconContent, mechanics: content?.MECHANICS });
  // build every theme's isometric terrain and check the texture contract (sizes, diamond masks, solid blocks, tiling)
  const t0 = performance.now();
  problems.push(...validateIso());
  console.log('[assets] iso terrain contract checked for all themes in ' + (performance.now() - t0).toFixed(0) + ' ms');
  const byKind = new Map<string, number>();
  for (const e of ASSET_MANIFEST) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log(
    `[assets] ${ASSET_MANIFEST.length} assets (${[...byKind].map(([k, v]) => `${v} ${k}`).join(', ')})` +
      (content ? `; checked ${cardIds.length} content card refs, ${nodeIds.length} node/skill refs` : ''),
  );
  if (problems.length) {
    for (const p of problems) console.error(`  x ${p}`);
    console.error(`[assets] ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('[assets] manifest OK');
}

void main();
