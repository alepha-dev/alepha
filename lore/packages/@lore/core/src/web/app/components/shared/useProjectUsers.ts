import { useClient, useQuery, useStore } from "alepha/react";

import type { ProjectController } from "../../../../api/controllers/ProjectController.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";

/**
 * A project's members, for resolving the user ids that quest rows carry.
 *
 * `history[].by`, `createdBy`, `completedBy`, `acceptedBy` and a comment's
 * `authorId` are all bare uuids, and every surface that shows one needs the
 * same name and avatar. One hook, and one request between every consumer
 * mounted at once: the query is keyed `["project-users", projectId]`, which
 * is also what a write that changes the members invalidates.
 *
 * Failures read as `[]`, and quietly: a name is chrome, and a transient
 * failure must cost the avatar, not the feed it sits in. The `onError` marks
 * it handled, so the root `ActionErrorToaster` skips it and error reporting
 * still sees it.
 */
export const useProjectUsers = (
  enabled = true,
  options: { assignable?: boolean } = {},
): ProjectUser[] => {
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id;
  const assignable = options.assignable === true;

  const { data } = useQuery(
    {
      // The assignee picker's read is its own key: it carries `assignable`,
      // which the other readers do not ask for.
      key: assignable
        ? ["project-users", projectId, "assignable"]
        : ["project-users", projectId],
      enabled: enabled && !!projectId,
      handler: () =>
        projectApi.getProjectUsers({
          params: { id: projectId as number },
          ...(assignable ? { query: { assignable: true } } : {}),
        }),
      onError: () => {},
    },
    [projectApi, projectId, assignable],
  );

  return data ?? [];
};

export interface ProjectUser {
  id: string;
  picture?: string;
  username?: string | null;
  email?: string | null;
  /**
   * Whether a quest can be handed to them (their rank grants
   * `quest:update`). Absent on a stub, which reads as assignable.
   */
  assignable?: boolean;
}
