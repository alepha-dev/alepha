import type { DurationLike } from "alepha/datetime";

/**
 * How a detail page keeps itself current (#Q3860): what to pass a `useQuery`
 * reading the quest or the epic the page shows.
 *
 * - **On a tab return, always**: `refetchOnFocus`, with a `staleTime` that
 *   bounds what a tab return asks (none within 10 s of the last read).
 * - **Every 15 s, only while live**: the item is `in_progress`, which is when
 *   an agent ticks objectives, comments and completes. Any other status gets
 *   no timer at all, and `runEvery` skips every tick while the document is
 *   hidden.
 * - **Never over an edit**: while the page has an editor, a draft or an edit
 *   sheet open, the caller passes `enabled: false`, which stops the timer,
 *   the tab-return read and any other run, and a read that lands then is
 *   held back. Closing the edit reads once if the copy went stale.
 *
 * ⚠️ A poll is allowed only in this shape: it stops itself the moment nothing
 * is moving and it pauses on a hidden tab. A blind "every X seconds" is the
 * QuestGraph incident (#F1057): a loader revalidating once a second for 51
 * minutes, 4,009 requests from one tab.
 */
export const liveRefresh = (
  live: boolean,
): {
  staleTime: DurationLike;
  refetchOnFocus: boolean;
  runEvery: DurationLike | undefined;
} => ({
  staleTime: LIVE_REFRESH_STALE,
  refetchOnFocus: true,
  runEvery: live ? LIVE_REFRESH_EVERY : undefined,
});

/**
 * Whether a refreshed copy should replace the one on the page: it differs,
 * and it was not written before it. An older copy (a read that was in flight
 * while a local write landed) never puts the page back; an equal
 * `updatedAt` with other content is a server-computed part that moved (an
 * epic's progress, a quest's live copies), which does not touch the row.
 */
export const isRefresh = (
  next: { updatedAt?: string },
  current: { updatedAt?: string },
): boolean => {
  if (next.updatedAt && current.updatedAt) {
    const at = (value: string) => new Date(value).getTime();
    if (at(next.updatedAt) < at(current.updatedAt)) return false;
  }
  return JSON.stringify(next) !== JSON.stringify(current);
};

/**
 * The two periods, named once so the quest page and the epic page agree.
 */
const LIVE_REFRESH_STALE: DurationLike = [10, "seconds"];
const LIVE_REFRESH_EVERY: DurationLike = [15, "seconds"];
