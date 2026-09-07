import type { Alepha } from "alepha";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

/**
 * Replace the open project in `currentProjectAtom`, keeping what only the
 * project LOADER knows.
 *
 * ## Why this exists
 *
 * Eight places write that atom after a save, and every one of them writes the
 * plain `projectResourceSchema` an endpoint answered. Two fields are not on
 * that schema and are added by `getProjectBySlug` alone: `permissions` - the
 * caller's effective set - and `rank`.
 *
 * ⚠️ Dropping them is not a cosmetic loss. `canInProject` answers **false**
 * for an absent set, deliberately (hiding a control is the safe direction when
 * the answer is unknown), so a writer that spreads a narrower shape hides
 * every rank-gated control on the page until the next navigation - the whole
 * sidebar included. That is a real regression, and it is exactly what the
 * capability toggle did: turn Releases back on, and the Releases entry never
 * came back, because the atom it wrote had no permissions in it.
 *
 * Caught by `settings-features.spec.ts`, which asserts the sidebar entry
 * returns. A merge at each of the eight call sites would have been eight
 * chances to forget; this is one.
 *
 * ## What it does not do
 *
 * It does not refetch. The effective set is a function of the caller's rank
 * and the project's capabilities, so **turning a capability on can widen it**
 * and this carries the stale one forward until the next navigation. That is
 * the right trade: the alternative is a second round trip on every settings
 * save, and the direction of the staleness is safe - a control that appears
 * one navigation late, never one the reader may not use.
 */
export const setCurrentProject = (alepha: Alepha, project: unknown): void => {
  const previous = alepha.store.get(currentProjectAtom);

  alepha.store.set(currentProjectAtom, {
    ...(project as Record<string, unknown>),
    // Only when the incoming shape does not carry them: a writer that DOES
    // know better - the route loader - must win.
    ...(previous?.permissions && !(project as any)?.permissions
      ? { permissions: previous.permissions }
      : {}),
    ...(previous?.rank && !(project as any)?.rank
      ? { rank: previous.rank }
      : {}),
  } as never);
};
