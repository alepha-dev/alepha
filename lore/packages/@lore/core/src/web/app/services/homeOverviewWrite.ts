import type { Alepha, Infer } from "alepha";

import { userDockAtom } from "../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../atoms/userProjectsAtom.ts";

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * Store what `getHomeOverview` answered: the membership list in
 * `userProjectsAtom`, the dock in `userDockAtom` (#E139).
 *
 * One place for the split, because four callers load the overview (the root
 * layout, the account shell, project creation, an accepted invitation) and a
 * caller that set only the first atom would leave the rail drawing the dock
 * as it was before the write.
 */
export const storeHomeOverview = (
  alepha: Alepha,
  overview: NonNullable<Infer<typeof userProjectsAtom.schema>> & {
    dock: number[];
  },
): void => {
  const { dock, ...projects } = overview;
  alepha.store.set(userProjectsAtom, projects);
  alepha.store.set(userDockAtom, dock);
};
