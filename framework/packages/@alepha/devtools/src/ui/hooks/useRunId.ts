import { useRouterState } from "alepha/react/router";

/**
 * The selected run, from the URL (`/apps/:runId/...`). Empty on the picker.
 */
export const useRunId = (): string =>
  String(useRouterState().params.runId ?? "");
