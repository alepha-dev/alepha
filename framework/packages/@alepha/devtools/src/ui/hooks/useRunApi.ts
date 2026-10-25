import { useCallback } from "react";

import { useRunId } from "./useRunId.ts";

/**
 * The selected run's API, as a path builder: `api("/logs")` is
 * `/apps/<runId>/api/logs`, which the devtools server forwards to that run's
 * inspector socket.
 *
 * The run comes from the URL, so a bookmarked panel names its app and two
 * tabs can inspect two apps.
 */
export const useRunApi = () => {
  const runId = useRunId();
  return useCallback(
    (path: string) => `/apps/${encodeURIComponent(runId)}/api${path}`,
    [runId],
  );
};
