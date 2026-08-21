import { useClient, useStore } from "alepha/react";
import { useEffect, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

/**
 * A project's members, for resolving the user ids that quest rows carry.
 *
 * `history[].by`, `createdBy`, `completedBy`, `acceptedBy` and a comment's
 * `authorId` are all bare uuids, and every surface that shows one needs the
 * same name and avatar. One hook, one fetch per mount, and `HttpClient`
 * dedupes the concurrent calls two mounted consumers make.
 *
 * Failures are swallowed to `[]`: a name is chrome, and a transient failure
 * must cost the avatar, not the feed it sits in.
 */
export const useProjectUsers = (enabled = true): ProjectUser[] => {
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const [users, setUsers] = useState<ProjectUser[]>([]);

  useEffect(() => {
    if (!enabled || !project?.id) return;
    let alive = true;
    projectApi
      .getProjectUsers({ params: { id: project.id } })
      .then((rows) => {
        if (alive) setUsers(rows);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [enabled, project?.id]);

  return users;
};

export interface ProjectUser {
  id: string;
  picture?: string;
  username?: string | null;
  email?: string | null;
}
