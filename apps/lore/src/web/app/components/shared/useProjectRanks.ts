import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { RankController, RankResource } from "alepha/api/ranks";
import { useClient, useStore } from "alepha/react";
import { useEffect, useState } from "react";

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
 * ⚠️ `loading` starts true and the effect never sets it, which is not a
 * stylistic choice: `setState` called synchronously inside an effect starts a
 * second render, and `react(set-state-in-effect)` refuses it. Everything the
 * first load writes happens in a promise callback.
 */
export const useProjectRanks = (): ProjectRanks => {
  const api = useClient<RankController>();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const [ranks, setRanks] = useState<RankResource[]>([]);
  const [loading, setLoading] = useState(true);

  const projectId = project?.id;

  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;

    api
      .getRanks({ params: { type: "project", scopeId: String(projectId) } })
      .then((res) => {
        // `?? []` rather than `res.items`: every consumer reads `.length`
        // during render, and a body that came back without the key would take
        // the page down rather than show it without a picker.
        if (!cancelled) setRanks(res?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setRanks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, api]);

  return {
    ranks,
    loading,
    reload: async () => {
      if (projectId === undefined) return;
      setLoading(true);
      try {
        const res = await api.getRanks({
          params: { type: "project", scopeId: String(projectId) },
        });
        setRanks(res?.items ?? []);
      } catch (error) {
        // Announced here and not on the first load: a reload follows an act
        // the reader just performed, so a failure is theirs to know about.
        toaster.error(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
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
