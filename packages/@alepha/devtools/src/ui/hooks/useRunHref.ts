import { useCallback } from "react";

import { useRunId } from "./useRunId.ts";

/**
 * A panel path inside the selected run: `href("/logs")` is
 * `/apps/<runId>/logs`.
 */
export const useRunHref = () => {
  const runId = useRunId();
  return useCallback(
    (path: string) =>
      `/apps/${encodeURIComponent(runId)}${path === "/" ? "" : path}`,
    [runId],
  );
};
