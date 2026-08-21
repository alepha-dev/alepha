import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LogEntry {
  level: string;
  message: string;
  module: string;
  service: string;
  context?: string;
  data?: any;
  timestamp: number;
  stack?: string;
}

export interface LogFilters {
  level: string;
  type: string;
  module: string;
  search: string;
  /**
   * Millisecond floor on entry duration, as a string so it drops straight into
   * the query string. Empty means no floor.
   */
  slowerThan?: string;
}

export interface UseLogTailResult {
  entries: LogEntry[];
  total: number;
  following: boolean;
  setFollowing: (v: boolean) => void;
  /**
   * Entries received while paused — the "N new lines" affordance.
   */
  pending: number;
  ratePerSecond: number;
  error?: string;
  flush: () => void;
  clear: () => void;
  reload: () => void;
}

const MAX_BUFFER = 2000;
const POLL_MS = 1000;

/**
 * A live tail over the devtools log buffer.
 *
 * This is cursor-based incremental fetch rather than a real event stream:
 * `$sse` is fixed to POST under the `/api` prefix, which would both squat the
 * inspected application's own API namespace and rule out `EventSource`. Polling
 * `?since=<cursor>` costs one small request per second and gives the same
 * behaviour — follow/pause, arrival rate, a pending count while paused.
 */
export const useLogTail = (filters: LogFilters): UseLogTailResult => {
  const http = useInject(HttpClient);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [following, setFollowing] = useState(true);
  const [pending, setPending] = useState(0);
  const [ratePerSecond, setRate] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const cursor = useRef(0);
  const held = useRef<LogEntry[]>([]);
  const recent = useRef<number[]>([]);
  const followingRef = useRef(following);
  followingRef.current = following;

  const buildQuery = useCallback(
    (since?: number) => {
      const q = new URLSearchParams();
      if (filters.level) q.set("level", filters.level);
      if (filters.type) q.set("type", filters.type);
      if (filters.module) q.set("module", filters.module);
      if (filters.search) q.set("search", filters.search);
      if (filters.slowerThan) q.set("slowerThan", filters.slowerThan);
      if (since) q.set("since", String(since + 1));
      q.set("limit", since ? "200" : "300");
      return q.toString();
    },
    [filters],
  );

  const poll = useCallback(
    async (reset: boolean) => {
      if (document.visibilityState !== "visible" && !reset) return;
      try {
        const res = await http.fetch(
          `/__devtools/api/logs?${buildQuery(reset ? undefined : cursor.current)}`,
        );
        const data = res.data as any;
        const incoming: LogEntry[] = data?.logs ?? [];
        setTotal(data?.total ?? 0);
        setError(undefined);

        if (reset) {
          cursor.current = incoming[0]?.timestamp ?? 0;
          held.current = [];
          setPending(0);
          setEntries(incoming);
          return;
        }

        if (incoming.length === 0) {
          recent.current.push(0);
          if (recent.current.length > 5) recent.current.shift();
          setRate(0);
          return;
        }

        cursor.current = Math.max(
          cursor.current,
          ...incoming.map((e) => e.timestamp),
        );

        recent.current.push(incoming.length);
        if (recent.current.length > 5) recent.current.shift();
        setRate(
          Math.round(
            recent.current.reduce((a, b) => a + b, 0) / recent.current.length,
          ),
        );

        if (followingRef.current) {
          setEntries((prev) => [...incoming, ...prev].slice(0, MAX_BUFFER));
        } else {
          held.current = [...incoming, ...held.current].slice(0, MAX_BUFFER);
          setPending(held.current.length);
        }
      } catch (e: any) {
        setError(e?.message ?? "Failed to load logs");
      }
    },
    [http, buildQuery],
  );

  // Filters changing invalidates the cursor: a widened filter exposes older
  // entries the tail would otherwise never ask for.
  useEffect(() => {
    void poll(true);
  }, [poll]);

  useEffect(() => {
    const id = setInterval(() => poll(false), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const flush = useCallback(() => {
    setEntries((prev) => [...held.current, ...prev].slice(0, MAX_BUFFER));
    held.current = [];
    setPending(0);
    setFollowing(true);
  }, []);

  const clear = useCallback(() => {
    held.current = [];
    setPending(0);
    setEntries([]);
  }, []);

  return {
    entries,
    total,
    following,
    setFollowing,
    pending,
    ratePerSecond,
    error,
    flush,
    clear,
    reload: () => poll(true),
  };
};
