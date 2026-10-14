// Single source of truth for font families used in canvas (Phaser) text and inline styles.
// DOM text should prefer the CSS variables in globals.css (--font-body, --font-label, --font-gothic, --font-display,
// --font-num), which mirror these. The UI pass owns the actual choices; everyone else imports these names instead
// of hard-coding a family.
//
// Readability pass: one pixel superfamily (Jersey), picked in-browser for legibility first. Jersey 20 has real
// lowercase and unambiguous digits; Jersey 10 is the chunky 10px-grid cut for headings and numbers (at 20/30/40px
// every font pixel is a whole 2/3/4px square); Jersey 15 is the small in-world label cut. Blackletter survives only
// in the main-menu logo wordmark.

/** Body / UI text: the most legible face (mixed case). */
export const FONT_UI = "'Jersey 20', 'Jersey 15', 'Courier New', monospace";
/** Short labels, key caps and small readouts (usually uppercase). */
export const FONT_LABEL = "'Jersey 20', 'Jersey 15', 'Courier New', monospace";
/** Big titles, headings and banners (never paragraphs). Crisp at multiples of 10px. */
export const FONT_DISPLAY = "'Jersey 10', 'Jersey 15', 'Courier New', monospace";
/** In-world numbers: damage, heals, counters. Crisp at multiples of 10px. */
export const FONT_NUM = "'Jersey 10', 'Jersey 15', 'Courier New', monospace";
/** Small in-world labels (ally names, cohort counts, loot names). Crisp at multiples of 15px. */
export const FONT_WORLD = "'Jersey 15', 'Jersey 20', 'Courier New', monospace";
/** Logo wordmark only (main menu FireTitle). */
export const FONT_LOGO = '"Cinzel"';

/** Integer canvas sizes (world px; the camera zooms by an integer, 1x at 720p, 2x at 1080p). */
export const WORLD_TEXT_PX = { label: 15, number: 20, numberSmall: 15, banner: 30 } as const;

/** Faces to await before Phaser rasterises any text (document.fonts.load specs). */
export const CANVAS_FONT_SPECS = ['20px "Jersey 10"', '15px "Jersey 15"', '20px "Jersey 20"'] as const;
