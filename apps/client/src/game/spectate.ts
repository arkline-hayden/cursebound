// Spectate target selection (pure; ui/Spectate.tsx draws the bar, CombatScene points the camera). A hero who has
// fallen for the round (dead, not merely downed and waiting on a revive) watches a teammate who is still standing.

export interface SpectatePlayer { s: number; life: 'alive' | 'downed' | 'dead' }

/** Teammates worth watching, standing ones first (a downed one can still be revived). */
export function spectateCandidates<P extends SpectatePlayer>(players: readonly P[], me: number): P[] {
  const others = players.filter((p) => p.s !== me && p.life !== 'dead');
  return [...others.filter((p) => p.life === 'alive'), ...others.filter((p) => p.life === 'downed')];
}

/** The slot the camera should follow, or null to follow your own hero. Keeps the chosen teammate while they stand. */
export function spectateTarget(players: readonly SpectatePlayer[], me: number, chosen: number | null): number | null {
  const mine = players.find((p) => p.s === me);
  if (!mine || mine.life !== 'dead') return null;
  const cands = spectateCandidates(players, me);
  if (!cands.length) return null;
  return cands.some((p) => p.s === chosen) ? chosen : cands[0]!.s;
}
