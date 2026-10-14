/**
 * Crisp pixel-art inline SVG icons for the DOM UI (16x16 grid scaled by `size`).
 * Icons are decorative (`aria-hidden`) by default; the surrounding UI provides the label.
 * Pass `title` to expose the icon as an image with an accessible name instead.
 * Unknown ids render a generic rune icon (never throw).
 */
import type React from 'react';
import { CARDS, CLASSES, FAMILIES, MECHANICS, NODES, SKILLS, TUTORIAL_CARD } from '@cursebound/content';
import { cardIconPixels, classEmblemPixels, mechIconPixels, nodeIconPixels, registerIconContent, registerMechanics, statIconPixels, type PixelRect } from './iconData';

// Node / card / class icons are derived from content data (branch motif, node kind, tier, card family + rarity).
registerIconContent({ nodes: NODES, skills: SKILLS, classes: CLASSES, cards: [...CARDS, TUTORIAL_CARD], families: FAMILIES });
registerMechanics(MECHANICS);

export { CARD_FAMILIES, CARD_IDS, NODE_IDS, STAT_NAMES, CLASS_IDS, MECH_IDS, hasCardIcon, hasNodeIcon, hasMechIcon, cardFamily, registerIconContent, registerMechanics } from './iconData';
export type { PixelRect, CardFamily, IconContent } from './iconData';

interface CommonProps {
  size?: number;
  className?: string;
  /** When set, the icon is announced as an image with this name (otherwise aria-hidden). */
  title?: string;
}

function PixelSvg({ rects, size = 32, className, title }: CommonProps & { rects: PixelRect[] }): React.JSX.Element {
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      focusable="false"
      className={className}
      style={{ imageRendering: 'pixelated', display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {rects.map(([x, y, w, h, fill], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}

/** Fate card icon: family motif + per-card gem; rare = gold corner, mythic = crimson prismatic gem. */
export function CardIcon(props: { cardId: string } & CommonProps): React.JSX.Element {
  return <PixelSvg rects={cardIconPixels(props.cardId)} size={props.size} className={props.className} title={props.title} />;
}

/** Skill-tree node (or skill) icon: branch motif, kind glyph (active / augment / stat), fork mark on choice nodes, gold rim from tier 3. */
export function NodeIcon(props: { nodeId: string } & CommonProps): React.JSX.Element {
  return <PixelSvg rects={nodeIconPixels(props.nodeId)} size={props.size} className={props.className} title={props.title} />;
}

/** Class crest for any class id (all ten classes have emblems; unknown ids get a rune). */
export function ClassEmblem(props: { classId: string } & CommonProps): React.JSX.Element {
  return <PixelSvg rects={classEmblemPixels(props.classId)} size={props.size} className={props.className} title={props.title} />;
}

/** Fate mechanic keyword icon (boon: round badge, bane: spiked crimson seal). Accepts 'mech:<id>' or '<id>'. */
export function MechIcon(props: { mechId: string } & CommonProps): React.JSX.Element {
  return <PixelSvg rects={mechIconPixels(props.mechId)} size={props.size} className={props.className} title={props.title} />;
}

/** Ledger stat group icon. */
export function StatIcon(props: { stat: string } & CommonProps): React.JSX.Element {
  return <PixelSvg rects={statIconPixels(props.stat)} size={props.size} className={props.className} title={props.title} />;
}
