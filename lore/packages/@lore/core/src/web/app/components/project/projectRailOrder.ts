/**
 * The projects the rail shows, in order (#Q3366).
 *
 * - Archived projects are left out, except the one being looked at (#Q2601).
 * - The ones in `opened` come first, in that order (the viewer's last opened,
 *   most recent first); the rest follow by `updatedAt`, newest first, which is
 *   also the whole order the first time, before anything was recorded.
 * - At most `cap`. The current project is always among them: when it falls
 *   outside, it takes the last slot, so the cap holds.
 */
export const projectRailOrder = <
  T extends { id: number; updatedAt: string; archivedAt?: string | null },
>(
  projects: T[],
  opened: number[],
  currentId: number | undefined,
  cap: number,
): T[] => {
  const rank = new Map(opened.map((id, index) => [id, index]));
  const ordered = projects
    .filter((it) => !it.archivedAt || it.id === currentId)
    .sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra !== undefined || rb !== undefined) {
        return (
          (ra ?? Number.POSITIVE_INFINITY) - (rb ?? Number.POSITIVE_INFINITY)
        );
      }
      return a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0;
    });
  const shown = ordered.slice(0, cap);
  if (currentId !== undefined && !shown.some((it) => it.id === currentId)) {
    const current = ordered.find((it) => it.id === currentId);
    if (current) shown.splice(cap - 1, 1, current);
  }
  return shown;
};
