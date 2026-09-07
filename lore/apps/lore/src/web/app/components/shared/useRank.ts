import { useStore } from "alepha/react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { canInProject } from "@/web/app/services/projectRank.ts";

/**
 * What the viewer may do in the project currently open.
 *
 * ⚠️ **Deliberately not called `can()` on its own.** Every `can` and `has` in
 * the framework - `useAuth().has`, `LinkProvider.can`,
 * `PermissionRegistryProvider.can`, `$page.can` - answers at APPLICATION
 * scope, from the permission list the server ships with the action registry,
 * and for a Lore user that list holds everything but `admin:*`. A bare `can`
 * here would read as true from the wrong layer in a code review, on a line
 * that looks identical to the app-scope one.
 *
 * ⚠️ A thin hook over {@link canInProject}, which is the real primitive: a
 * `$page` loader cannot call a hook, and the loader and the component must not
 * disagree about which pages exist. Same arrangement as `hasCapability`.
 *
 * ⚠️ **Never enforcement.** The server's gate answers the real request
 * whatever this hides.
 */
export const useRank = (): Rank => {
  const [project] = useStore(currentProjectAtom);

  return {
    rank: project?.rank,
    can: (permission: string) => canInProject(project, permission),
  };
};

// ---------------------------------------------------------------------------------------------------------------------

export interface Rank {
  /**
   * The rank the viewer holds here, for naming it. Absent for a privileged
   * identity, which holds no rank.
   */
  rank?: { key: string; name: string };

  /**
   * Does the viewer hold this permission in this project?
   */
  can: (permission: string) => boolean;
}
