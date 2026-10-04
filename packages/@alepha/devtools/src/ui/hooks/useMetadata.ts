import { type DevMetadata, devMetadataSchema } from "alepha/inspector";
import { useInject, useStore } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

import { devMetadataAtom } from "../atoms/devMetadataAtom.ts";
import { useRunApi } from "./useRunApi.ts";
import { useRunId } from "./useRunId.ts";

export interface UseMetadataResult {
  data?: DevMetadata;
  loading: boolean;
  error?: string;
  reload: () => void;
}

/**
 * Read the selected run's metadata, fetching it once per run.
 *
 * Every screen calls this; only the first call that finds the atom empty
 * performs the request. `error` is surfaced rather than swallowed — a failed
 * fetch previously rendered as an empty list, which is indistinguishable from
 * an application that genuinely declares none of the thing you're looking at.
 */
export const useMetadata = (): UseMetadataResult => {
  const http = useInject(HttpClient);
  const api = useRunApi();
  const runId = useRunId();
  const [held, setHeld] = useStore(devMetadataAtom);
  // Another run's metadata is no answer for this one.
  const data = held?.runId === runId ? held.metadata : undefined;
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | undefined>();

  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await http.fetch(api("/metadata"), {
        schema: { response: devMetadataSchema },
      });
      setHeld({ runId, metadata: res.data });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load metadata");
    } finally {
      setLoading(false);
    }
  }, [http, api, runId, setHeld]);

  useEffect(() => {
    if (!data) {
      // An effect that starts an I/O load is the "synchronize with an external
      // system" case the rule exempts; it reports it because the loader flips
      // `loading` before its first await.
      // oxlint-disable-next-line react/set-state-in-effect
      void fetchMetadata();
    }
  }, [data, fetchMetadata]);

  return { data, loading, error, reload: fetchMetadata };
};
