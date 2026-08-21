import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

export interface JobRuntime {
  name: string;
  description?: string;
  type: "cron" | "queue" | "direct";
  priority: string;
  cron?: string;
  timeout?: string;
  retry?: { retries: number };
  recent: { ok: number; error: number; lastRun?: string };
}

export interface JobExecution {
  id: string;
  jobName: string;
  status: string;
  attempt: number;
  maxAttempts?: number;
  payload?: unknown;
  error?: string;
  logs?: unknown;
  startedAt?: string | number;
  completedAt?: string | number;
  createdAt?: string | number;
  scheduledAt?: string | number;
  can?: { retry: boolean; cancel: boolean };
}

/**
 * Runtime job state — execution counts and last run.
 *
 * Separate from the metadata atom on purpose: `$job` declarations are static
 * reflection, whereas these numbers change every time a job runs, so they
 * refresh on their own cadence.
 */
export const useJobs = (pollMs = 5000) => {
  const http = useInject(HttpClient);
  const [jobs, setJobs] = useState<JobRuntime[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await http.fetch("/__devtools/api/jobs");
      setJobs(((res.data as any)?.jobs ?? []) as JobRuntime[]);
      setError(undefined);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [http]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // `loading` before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { jobs, error, loading, reload: load };
};
