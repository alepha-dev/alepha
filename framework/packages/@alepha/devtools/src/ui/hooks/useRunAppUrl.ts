import { useCallback } from "react";

import { useRunId } from "./useRunId.ts";

/**
 * A path on the selected run's own HTTP server, reached through the devtools
 * server: `url("/api/users")` is `/apps/<runId>/http/api/users`. The page is
 * not on the app's origin, so a direct request would be cross-origin.
 */
export const useRunAppUrl = () => {
  const runId = useRunId();
  return useCallback(
    (path: string) => `/apps/${encodeURIComponent(runId)}/http${path}`,
    [runId],
  );
};
