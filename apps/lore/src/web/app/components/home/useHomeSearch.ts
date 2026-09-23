import { useAction, useClient } from "alepha/react";
import { useState } from "react";

import type { SearchController } from "@/api/controllers/SearchController.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

/**
 * One hit of `SearchController.search`, the row the ⌘K palette renders too.
 */
export interface HomeSearchHit {
  kind: "quest" | "folio" | "directory" | "epic" | "release" | "feedback";
  id: string;
  shortId: number;
  title: string;
  tag?: string;
  description?: string;
  protected?: boolean;
}

/**
 * The hits of one project, in the order the server ranked them.
 */
export interface HomeSearchGroup {
  project: ProjectOverviewResource;
  hits: HomeSearchHit[];
}

/**
 * Search every project the caller belongs to from Home.
 *
 * There is no cross-project search action: `SearchController.search` is
 * `/projects/:projectId/search`, member-gated and hard-filtered by project. So
 * Home asks it once per project, and `BatchCollector` coalesces the calls into
 * one `POST /api/_batch`. What that buys is every gate the palette already has
 * (membership, rank, the capabilities a project turned off) for free; what it
 * costs is one set of statements per project per query, which is why each
 * project answers at most `PER_PROJECT` hits. A dedicated action is the next
 * step if this layout stays.
 *
 * A project that refuses (a rank without `quest:read` or `folio:read`) drops
 * out of the results quietly: it has nothing to show, and one refusal must not
 * cost the other projects their hits.
 */
export const useHomeSearch = (projects: ProjectOverviewResource[]) => {
  const searchApi = useClient<SearchController>();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<HomeSearchGroup[]>([]);

  const search = useAction<[string], void>(
    {
      handler: async (q) => {
        const settled = await Promise.allSettled(
          projects.map((project) =>
            searchApi.search({
              params: { projectId: project.id },
              query: { q, limit: PER_PROJECT },
            }),
          ),
        );
        const needle = q.toLowerCase();
        const found = projects
          .map((project, index) => {
            const result = settled[index];
            const hits =
              result?.status === "fulfilled"
                ? (result.value.hits as HomeSearchHit[])
                : [];
            return { project, hits };
          })
          .filter((group) => group.hits.length > 0);
        // Recency order, except that a project holding an exact or leading
        // title match comes first: that is what the reader was typing.
        const best = (group: HomeSearchGroup) =>
          Math.max(
            ...group.hits.map((hit) => {
              const title = hit.title.toLowerCase();
              if (title === needle) return 2;
              return title.startsWith(needle) ? 1 : 0;
            }),
          );
        setGroups(found.sort((a, b) => best(b) - best(a)));
      },
      debounce: 250,
      onError: () => {},
    },
    [projects, searchApi],
  );

  /**
   * Clearing the box clears the results at once, not a debounce later: stale
   * hits under an empty input read as results for a query nobody typed.
   */
  const update = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      search.cancel();
      setGroups([]);
      return;
    }
    void search.run(value.trim());
  };

  const needle = query.trim().toLowerCase();
  const projectMatches = needle
    ? projects.filter((project) => project.title.toLowerCase().includes(needle))
    : [];

  return {
    query,
    update,
    groups,
    projectMatches,
    loading: search.loading,
  };
};

/**
 * Hits one project may contribute to a query.
 */
const PER_PROJECT = 5;
