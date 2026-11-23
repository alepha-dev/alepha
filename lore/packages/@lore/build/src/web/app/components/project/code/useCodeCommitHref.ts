import {
  canInProject,
  capabilityOption,
  currentProjectAtom,
  hasCapability,
} from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";

import type { CodeRepositoryController } from "../../../../../api/controllers/CodeRepositoryController.ts";

/**
 * Where a commit links (#Q4136), the hook Build registers on core's
 * `CommitLinkRegistry`: the commit page of the Lore repository the trail's
 * `repo` names (`<project>/<repo>` or `<repo>`), else of the project's
 * default one (its only one, or the one named like the project), else
 * nothing. Only with Build's repositories on and `code:read`; the list of
 * repositories is one query a project, shared by every link on the page.
 */
export const useCodeCommitHref = (
  sha: string,
  repo?: string,
): `/${string}` | undefined => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<CodeRepositoryController>();
  const allowed = Boolean(
    project &&
    hasCapability(project, "build") &&
    capabilityOption(project, "build", "repositories") &&
    canInProject(project, "code:read"),
  );
  const { data } = useQuery(
    {
      enabled: allowed,
      key: ["code-repos", project?.id],
      handler: async () =>
        api.listCodeRepositories({ params: { projectId: project!.id } }),
      onError: () => {},
    },
    [allowed, project?.id],
  );
  if (!allowed || !project || !data) return undefined;
  const slugs = data.repositories.map((it) => it.slug);
  const named = repo?.includes("/")
    ? repo.split("/")[0] === project.slug
      ? repo.split("/")[1]
      : undefined
    : repo;
  const target =
    (named && slugs.includes(named) ? named : undefined) ??
    (slugs.length === 1
      ? slugs[0]
      : slugs.includes(project.slug)
        ? project.slug
        : undefined);
  return target ? `/${project.slug}/code/${target}/commit/${sha}` : undefined;
};
