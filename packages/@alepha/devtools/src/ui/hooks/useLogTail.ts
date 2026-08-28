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
  /**
   * Position in the collector's buffer. Monotonic, never reused, and the only
   * thing the tail cursors on - see `MemoryDestinationProvider`.
   */
  seq: number;
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
  /**
   * Entries the server-side buffer evicted. Surfaced as a marker, because it
   * is the one kind of loss the tail cannot make up for by polling harder.
   */
  dropped: number;
  error?: string;
  flush: () => void;
  clear: () => void;
  reload: () => void;
}

const MAX_BUFFER = 2000;
const POLL_MS = 1000;
/**
 * How many catch-up requests a single tick may make.
 *
 * Bounds one tick at `8 * limit` entries, so a firehose cannot keep the loop
 * running past the next tick, while still draining an ordinary burst well
 * inside a second. Stopping early costs nothing: the cursor is a sequence
 * number, so the following tick resumes exactly where this one stopped.
 */
const MAX_CATCHUP_ROUNDS = 8;

/**
 * A live tail over the devtools log buffer.
 *
 * This is cursor-based incremental fetch rather than a real event stream:
 * `$sse` is fixed to POST under the `/api` prefix, which would both squat the
 * inspected application's own API namespace and rule out `EventSource`. Polling
 * `?after=<cursor>` costs one small request per second and gives the same
 * behaviour — follow/pause, arrival rate, a pending count while paused.
 *
 * The cursor is a sequence number, not a timestamp. It used to be the newest
 * timestamp seen, sent back as `since = t + 1` so the server's `>=` would not
 * re-deliver it — which meant every entry sharing that millisecond was skipped
 * for good, and a dev boot logs dozens per millisecond. A page was capped at
 * 200 newest-first on top of that, so the rest of a burst fell behind a cursor
 * that had already moved past it. Both are closed: the server hands back the
 * oldest unseen page and says whether more are waiting, and this hook keeps
 * asking until they are not.
 */
export const useLogTail = (filters: LogFilters): UseLogTailResult => {
  const http = useInject(HttpClient);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [following, setFollowing] = useState(true);
  const [pending, setPending] = useState(0);
  const [ratePerSecond, setRate] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState<string | undefined>();

  // `undefined` rather than 0, because 0 is a real sequence number: the very
  // first line this process logged.
  const cursor = useRef<number | undefined>(undefined);
  const held = useRef<LogEntry[]>([]);
  const recent = useRef<number[]>([]);
  const followingRef = useRef(following);
  followingRef.current = following;

  const buildQuery = useCallback(
    (after?: number) => {
      const q = new URLSearchParams();
      if (filters.level) q.set("level", filters.level);
      if (filters.type) q.set("type", filters.type);
      if (filters.module) q.set("module", filters.module);
      if (filters.search) q.set("search", filters.search);
      if (filters.slowerThan) q.set("slowerThan", filters.slowerThan);
      if (after !== undefined) q.set("after", String(after));
      q.set("limit", after !== undefined ? "200" : "300");
      return q.toString();
    },
    [filters],
  );

  /**
   * Move the cursor past everything in a page. Highest sequence wins, so it
   * never goes backwards however the page happened to be ordered.
   */
  const advance = useCallback((page: LogEntry[]) => {
    for (const entry of page) {
      if (typeof entry.seq !== "number") continue;
      if (cursor.current === undefined || entry.seq > cursor.current) {
        cursor.current = entry.seq;
      }
    }
  }, []);

  const poll = useCallback(
    async (reset: boolean) => {
      if (document.visibilityState !== "visible" && !reset) return;
      try {
        // Dropping the cursor is all a reset is: with none, the route hands
        // back the newest window and says there is nothing more, so the loop
        // below runs exactly once.
        if (reset) cursor.current = undefined;

        // Otherwise keep asking while the route says there is more, rather
        // than waiting for the next tick. One request per tick is what
        // truncated bursts: a page is capped, so everything past the cap
        // needed another request now, not a second later behind a cursor that
        // had already moved past it.
        const incoming: LogEntry[] = [];
        let total = 0;
        let evicted = 0;
        for (let round = 0; round < MAX_CATCHUP_ROUNDS; round++) {
          const res = await http.fetch(
            `/__devtools/api/logs?${buildQuery(cursor.current)}`,
          );
          const data = res.data as any;
          const page: LogEntry[] = data?.logs ?? [];
          total = data?.total ?? 0;
          evicted = data?.dropped ?? 0;
          // Pages arrive oldest first and are newest-first within themselves,
          // so each one goes in front of what is already collected.
          incoming.unshift(...page);
          advance(page);
          if (!data?.hasMore || page.length === 0) break;
        }
        setTotal(total);
        setDropped(evicted);
        setError(undefined);

        if (reset) {
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
    [http, buildQuery, advance],
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
    dropped,
    error,
    flush,
    clear,
    reload: () => poll(true),
  };
};
