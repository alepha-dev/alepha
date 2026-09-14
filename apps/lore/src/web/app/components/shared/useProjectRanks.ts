import { useToast } from "@alepha/ui";
import type { RankController, RankResource } from "alepha/api/ranks";
import { useClient, useQuery, useStore } from "alepha/react";
import { HttpError } from "alepha/server";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

/**
 * The ranks of the open project, for the surfaces that assign one.
 *
 * Fetched rather than read off an atom: the project loader fills seven atoms
 * already and this list is read on exactly two screens - the members page and
 * the matrix - so putting it in the layout's loader would make every other
 * page pay for it.
 *
 * ⚠️ Reading a scope's ranks IS managing it (`RankController.getRanks` asks
 * `assertCanManage`), so this answers an EMPTY LIST to a member who may not,
 * silently. That is the right shape for the caller: no ranks, no picker, and
 * every surface that offers one is gated on `member:manage` anyway. A toast
 * for a 403 nobody can act on is noise on a page about something else.
 *
 * Any other failure is toasted, the first load's included: one query cannot
 * be quiet on its first run and loud on `reload`, and a failure that is not
 * a refusal is worth knowing about either way. Keyed
 * `["project-ranks", projectId]`, which the ranks page's writes invalidate.
 */
export const useProjectRanks = (): ProjectRanks => {
  const api = useClient<RankController>();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id;

  const query = useQuery(
    {
      key: ["project-ranks", projectId],
      enabled: projectId !== undefined,
      handler: () =>
        api.getRanks({
          params: { type: "project", scopeId: String(projectId) },
        }),
      // Handled here, so the root `ActionErrorToaster` never shows it: quiet
      // for the 403 a reader who may not manage ranks always gets, toasted by
      // hand for anything else.
      onError: (error) => {
        if (HttpError.is(error, 403)) return;
        toaster.error(error.message);
      },
    },
    [api, projectId],
  );

  return {
    // `?? []` rather than `items`: every consumer reads `.length` during
    // render, and a body that came back without the key would take the page
    // down rather than show it without a picker.
    ranks: query.data?.items ?? [],
    loading: query.loading,
    reload: async () => {
      await query.refetch();
    },
  };
};

export interface ProjectRanks {
  /**
   * Every rank of the open project, built-ins included. Empty while loading,
   * and empty for a reader who may not manage them.
   */
  ranks: RankResource[];
  loading: boolean;
  reload: () => Promise<void>;
}
