import type { InspectorRun } from "alepha/inspector";
import { useStore } from "alepha/react";

import { devRunsAtom } from "../atoms/devRunsAtom.ts";
import { useRunId } from "./useRunId.ts";

/**
 * The selected run, from the last run list, once it has loaded.
 */
export const useCurrentRun = (): InspectorRun | undefined => {
  const runId = useRunId();
  const [state] = useStore(devRunsAtom);
  return state?.runs.find((run) => run.runId === runId);
};
