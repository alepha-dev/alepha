import { useClient, useQuery, useStore } from "alepha/react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

/**
 * A project's members, for resolving the user ids that quest rows carry.
 *
 * `history[].by`, `createdBy`, `completedBy`, `acceptedBy` and a comment's
 * `authorId` are all bare uuids, and every surface that shows one needs the
 * same name and avatar. One hook, and one request between every consumer
 * mounted at once: the query is keyed `["project-users", projectId]`, which
 * is also what a write that changes the members invalidates
 * (`useRemoveMember`).
 *
 * Failures read as `[]`, and quietly: a name is chrome, and a transient
 * failure must cost the avatar, not the feed it sits in. The `onError` marks
 * it handled, so the root `ActionErrorToaster` skips it and error reporting
 * still sees it.
 */
export const useProjectUsers = (enabled = true): ProjectUser[] => {
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id;

  const { data } = useQuery(
    {
      key: ["project-users", projectId],
      enabled: enabled && !!projectId,
      handler: () =>
        projectApi.getProjectUsers({ params: { id: projectId as number } }),
      onError: () => {},
    },
    [projectApi, projectId],
  );

  return data ?? [];
};

export interface ProjectUser {
  id: string;
  picture?: string;
  username?: string | null;
  email?: string | null;
}
