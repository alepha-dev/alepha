import type { InspectorRun } from "alepha/inspector";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

/**
 * The runs on this machine, from the devtools server, kept current.
 *
 * Polled: apps start, stop and restart (every HMR reload under `alepha dev`
 * is a new run), and the list has to follow without a reload. Live runs
 * first, then the dead ones still holding logs.
 */
export const useRuns = (pollMs = 2000) => {
  const http = useInject(HttpClient);
  const [runs, setRuns] = useState<InspectorRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const res = await http.fetch("/runs");
      const list = ((res.data as any)?.runs ?? []) as InspectorRun[];
      setRuns(
        list.toSorted((a, b) =>
          a.status === b.status
            ? b.startedAt.localeCompare(a.startedAt)
            : a.status === "live"
              ? -1
              : 1,
        ),
      );
      setError(undefined);
    } catch (e: any) {
      setError(e?.message ?? "Failed to list the running apps");
    } finally {
      setLoaded(true);
    }
  }, [http]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // state before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { runs, loaded, error, reload: load };
};
