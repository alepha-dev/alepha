import { $hook, $inject } from "alepha";

import { ProjectJoinPolicy } from "../services/ProjectJoinPolicy.ts";

/**
 * Keeps Viewer inside its allowlist while a project is open (#Q3644), on
 * the framework's rank service itself rather than in one controller: a rank
 * is written by the module's routes, by Lore's seeding and by specs, and the
 * rule must hold for every one of them.
 */
export class ViewerRankLockHooks {
  protected readonly joinPolicy = $inject(ProjectJoinPolicy);

  protected readonly onRankSaving = $hook({
    on: "organization:rank:save:before",
    handler: ({ organizationId, key, permissions }) =>
      this.joinPolicy.assertViewerWrite(organizationId, key, permissions),
  });

  protected readonly onRankDeleting = $hook({
    on: "organization:rank:delete:before",
    handler: ({ organizationId, key }) =>
      this.joinPolicy.assertViewerWrite(organizationId, key, undefined),
  });
}
