import { $inject, Alepha } from "alepha";
import { ScopeGrantsProvider } from "alepha/server/links";

import { currentProjectAtom } from "../atoms/currentProjectAtom.ts";

/**
 * What `action.can()` means inside a project.
 *
 * `LinkProvider.can("createQuest")` asks whether the action is in the registry
 * the server sent, and the server prunes on the caller's ROLES - so for any
 * signed-in Lore user the answer is yes for every write action in the app, in
 * every project. That is why 42 of the 46 files under `components/project`
 * carry no `.can()` at all: for a member the answer was always the same.
 *
 * Substituting this is what makes the existing idiom rank-aware. Every
 * `api.updateQuestById.can()` already written, and every one added by the
 * sweep, now answers for the project currently open - and none of them repeats
 * a permission string, because the action carries its own requirement from
 * `$ownsProject({ requires })` all the way through the registry.
 *
 * ⚠️ `undefined` outside a project, never `[]`. The account pages, the admin
 * shell and the home dashboard are not inside a rank scope, and an empty array
 * there would hide every control in them. `[]` means "in a scope, holding
 * nothing", which is a Viewer with no permissions at all.
 *
 * ⚠️ Synchronous, and it must be: `can()` runs during render on both sides of
 * hydration, and the project layout's loader has already filled the atom
 * before anything under `/:projectSlug` renders. This reads; it never fetches.
 *
 * ⚠️ **Never enforcement.** The server's `$ownsProject` gate answers the real
 * request whatever this hides.
 */
export class ProjectScopeGrants extends ScopeGrantsProvider {
  protected readonly alepha = $inject(Alepha);

  public override current(): readonly string[] | undefined {
    return this.alepha.store.get(currentProjectAtom)?.permissions;
  }
}
