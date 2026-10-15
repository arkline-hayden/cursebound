import { isClassUnlocked, type BountyView, type PlayerProgress } from '@cursebound/content';
import { accountApi, api, onlineMode } from './api';
import { currentAccount, syncLinkedXp } from './auth';
import { createStore } from './store';

// Player progression and the daily bounty, client side (content progression.ts / bounties.ts).
// Progress: signed in online, the cloud account's (GET /account/progress, the cloud is the source of truth); otherwise
// the local profile's (GET /local/profiles/:id/progress). Bounty: online, the cloud's (GET /bounty; completion for a
// signed-in caller), falling back to this machine's local bounty when the cloud is unreachable; local mode, the local
// one (GET /local/bounty). A bounty run passes the cloud bounty through to the local authority, which validates the
// modifier id against content.
// Class gates: the authority refuses locked classes for local profiles; a guest joining a friend's host over
// peer-to-peer is seated by the host's machine, which cannot see the guest's cloud level, so the guest's own client
// gates the class picker (`classUnlocked`) before joining.

export interface ProgressState {
  progress: PlayerProgress | null;
  bounty: BountyView | null;
  /** client clock minus server clock when the bounty was fetched (the countdown runs on server time) */
  skewMs: number;
  /** where the bounty came from: a cloud bounty must be passed through when starting a run */
  bountySource: 'cloud' | 'local' | null;
}

export const progressStore = createStore<ProgressState>({ progress: null, bounty: null, skewMs: 0, bountySource: null });

/** Refresh the player's progress (and, online, sync the cloud XP into the linked local profile's class gate). */
export async function refreshProgress(profileId: string | null): Promise<PlayerProgress | null> {
  try {
    let p: PlayerProgress | null = null;
    if ((await onlineMode()) && currentAccount()) {
      p = await accountApi<PlayerProgress>('GET', '/account/progress');
      void syncLinkedXp(p.xp).catch(() => undefined);
    } else if (profileId) {
      p = await api<PlayerProgress>('GET', `/local/profiles/${encodeURIComponent(profileId)}/progress`);
    }
    progressStore.set({ progress: p });
    return p;
  } catch {
    return progressStore.get().progress;
  }
}

/** Refresh the daily bounty (cloud when online, else local). */
export async function refreshBounty(profileId: string | null): Promise<BountyView | null> {
  const local = async () => (await api<{ bounty: BountyView }>('GET', `/local/bounty${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`)).bounty;
  try {
    let bounty: BountyView;
    let source: 'cloud' | 'local' = 'local';
    if (await onlineMode()) {
      try { bounty = (await accountApi<{ bounty: BountyView }>('GET', '/bounty')).bounty; source = 'cloud'; } catch { bounty = await local(); }
    } else bounty = await local();
    progressStore.set({ bounty, bountySource: source, skewMs: Date.now() - bounty.serverNow });
    return bounty;
  } catch {
    return progressStore.get().bounty;
  }
}

/** POST /rooms `bounty` option for the current bounty: the cloud bounty is passed through, the local one is `true`. */
export function bountyRoomOption(): true | { id: string; modifierId: string } | null {
  const { bounty, bountySource } = progressStore.get();
  if (!bounty) return null;
  return bountySource === 'cloud' ? { id: bounty.id, modifierId: bounty.modifier.id } : true;
}

/** Client-side class gate (guests of a peer-to-peer host rely on it; the authority enforces it for local profiles).
 *  Unknown progress (still loading, offline) does not lock anything here: the authority still has the final word. */
export function classUnlocked(classId: string, progress: PlayerProgress | null = progressStore.get().progress): boolean {
  return !progress || isClassUnlocked(classId, progress.level);
}

/** "hh:mm:ss" until the bounty rerolls. */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

