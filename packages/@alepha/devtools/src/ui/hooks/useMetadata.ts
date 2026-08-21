import { useInject, useStore } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

// Relative, never the package's own `@alepha/devtools` barrel: importing the
// public entrypoint from inside the package creates the circular dependency
// the build's module analysis flags.
import {
  type DevMetadata,
  devMetadataSchema,
} from "../../schemas/DevMetadata.ts";
import { devMetadataAtom } from "../atoms/devMetadataAtom.ts";

export interface UseMetadataResult {
  data?: DevMetadata;
  loading: boolean;
  error?: string;
  reload: () => void;
}

/**
 * Read the application metadata, fetching it once per session.
 *
 * Every screen calls this; only the first call that finds the atom empty
 * performs the request. `error` is surfaced rather than swallowed — a failed
 * fetch previously rendered as an empty list, which is indistinguishable from
 * an application that genuinely declares none of the thing you're looking at.
 */
export const useMetadata = (): UseMetadataResult => {
  const http = useInject(HttpClient);
  const [data, setData] = useStore(devMetadataAtom);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | undefined>();

  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await http.fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      });
      setData(res.data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load metadata");
    } finally {
      setLoading(false);
    }
  }, [http, setData]);

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
