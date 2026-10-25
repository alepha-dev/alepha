import type { Alepha } from "alepha";

import { userProjectsAtom } from "../atoms/userProjectsAtom.ts";

/**
 * Replace one project's row in `userProjectsAtom` with what a write answered,
 * keeping what only `getHomeOverview` knows.
 *
 * ## Why this exists
 *
 * An update response is the plain `projectResourceSchema`; the overview row is
 * `projectOverviewResourceSchema`, which adds fields computed by the overview
 * read alone. ⚠️ The atom VALIDATES on write, so a row missing one of them is
 * not a cosmetic loss: the write throws after the server already saved, and
 * the user sees an error toast for a change that went through. That is what
 * the capability toggle did with `lastActivityAt` (#Q2631), because
 * `ProjectUpdate` and `useCapability` each rebuilt the row by hand and only
 * one of them had learned about it. One merge means the next field added to
 * the overview row is added here, once.
 *
 * - `areaCount`, `openQuestCount` and `owner` are carried forward: an update
 *   has no idea of them, and dropping them would zero the counts and flip the
 *   Owner badge off.
 * - `lastActivityAt` is the response's `updatedAt`: this write is the
 *   project's newest activity, and its `updatedAt` says exactly when.
 *
 * A no-op when the overview has not been loaded yet, or does not hold the
 * project.
 */
export const mergeIntoProjectOverview = (
  alepha: Alepha,
  project: unknown,
): void => {
  const overview = alepha.store.get(userProjectsAtom);
  if (!overview) return;
  const updated = project as Record<string, unknown> & {
    id: number;
    updatedAt: string;
  };

  alepha.store.set(userProjectsAtom, {
    ...overview,
    projects: overview.projects.map((p) =>
      p.id === updated.id
        ? ({
            ...updated,
            areaCount: p.areaCount,
            openQuestCount: p.openQuestCount,
            owner: p.owner,
            lastActivityAt: updated.updatedAt,
          } as never)
        : p,
    ),
  });
};
