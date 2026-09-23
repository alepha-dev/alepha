import { useRouter } from "alepha/react/router";

import type { AppRouter } from "../../AppRouter.ts";
import type { HomeSearchHit } from "./useHomeSearch.ts";

/**
 * Where a search hit opens, as an address rather than a push, so Home can
 * render each hit as a real link. The same destinations as the ⌘K palette's
 * `go` (`Spotlight.tsx`).
 */
export const useHomeSearchHitHref = () => {
  const router = useRouter<AppRouter>();

  return (projectSlug: string, hit: HomeSearchHit): string => {
    const params = { projectSlug };
    if (hit.kind === "quest") {
      return router.path("projectQuest", {
        params: { ...params, shortId: String(hit.shortId) },
      });
    }
    if (hit.kind === "folio") {
      return router.path("projectFoliosFolio", {
        params: { ...params, shortId: String(hit.shortId) },
      });
    }
    if (hit.kind === "epic") {
      return router.path("projectEpic", {
        params: { ...params, epicNumber: String(hit.shortId) },
      });
    }
    if (hit.kind === "release") {
      // A release page is addressed by its TAG; one from before tags were
      // required has none, and only the list can open it.
      return hit.tag
        ? router.path("projectRelease", {
            params: { ...params, releaseTag: hit.tag },
          })
        : router.path("projectReleases", { params });
    }
    if (hit.kind === "feedback") {
      return router.path("projectFeedback", {
        params,
        query: { feedback: String(hit.shortId) },
      });
    }
    // A directory has no route of its own: the workspace reaches it.
    return router.path("projectFolios", { params });
  };
};
