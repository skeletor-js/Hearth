// Replay/live merge (U6). While ChatView replays a session's persisted
// transcript, live updates for that session keep arriving (the normal way a
// headless routine's stream is encountered) — they are buffered and applied
// AFTER the replay so history can never append below live content.
//
// Because ChatView persists live updates immediately (durability across
// mid-turn reloads), an update buffered during the replay window may ALSO be
// inside the snapshot `sessions.get` returned — applying it again would
// duplicate it. Arrival order and persist order are the same sequence, so the
// overlap is exactly: the snapshot's update-tail equals the buffer's front.
// Positional matching makes this correct even when consecutive deltas carry
// identical text.
import type { SessionUpdate } from '../../../electron/shared/protocol'

export interface SnapshotEntry {
  kind: string
  update?: SessionUpdate
}

/** The buffered updates still missing from the snapshot: drops the longest
 * buffer-front already present as the snapshot's update-tail. */
export function pendingAfterSnapshot(buffered: SessionUpdate[], snapshot: SnapshotEntry[]): SessionUpdate[] {
  if (buffered.length === 0) return []
  const persisted = snapshot.filter((e) => e.kind === 'update' && e.update).map((e) => JSON.stringify(e.update))
  for (let k = Math.min(buffered.length, persisted.length); k > 0; k--) {
    const tail = persisted.slice(persisted.length - k)
    if (tail.every((s, i) => s === JSON.stringify(buffered[i]))) return buffered.slice(k)
  }
  return buffered
}
