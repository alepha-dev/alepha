import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

import { useRunApi } from "./useRunApi.ts";

export interface TraceSummary {
  traceId: string;
  name: string;
  startTime: number;
  duration: number;
  status: "unset" | "ok" | "error";
  spanCount: number;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "unset" | "ok" | "error";
  statusMessage?: string;
  exception?: { type: string; message: string };
  attributes: Record<string, string | number | boolean>;
  links: Array<{ traceId: string; spanId: string }>;
  /**
   * Set on a parent with five or more children of one name.
   */
  nPlusOne?: { name: string; count: number };
}

export interface TraceLogLine {
  level: string;
  message: string;
  module: string;
  service: string;
  timestamp: number;
  spanId?: string;
  data?: unknown;
}

export interface TraceDetail {
  traceId: string;
  spans: TraceSpan[];
  logs: TraceLogLine[];
}

/**
 * The run's recent traces, polled.
 *
 * `available` is false when the run answers 404 on `/traces`: an app built
 * before tracing existed, which the nav then hides rather than shows empty.
 */
export const useTraces = (pollMs = 3000) => {
  const http = useInject(HttpClient);
  const api = useRunApi();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [available, setAvailable] = useState<boolean | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await http.fetch(api("/traces"));
      setTraces(((res.data as any)?.traces ?? []) as TraceSummary[]);
      setAvailable(true);
      setError(undefined);
    } catch (e) {
      if ((e as { status?: number })?.status === 404) {
        setAvailable(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load traces");
    }
  }, [http, api]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
    if (!pollMs) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { traces, available, error, reload: load };
};

/**
 * One trace, with its spans and log lines. Loaded when `traceId` changes.
 */
export const useTrace = (traceId: string | undefined) => {
  const http = useInject(HttpClient);
  const api = useRunApi();
  const [trace, setTrace] = useState<TraceDetail | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!traceId) {
      return;
    }
    let current = true;
    http
      .fetch(api(`/traces/${encodeURIComponent(traceId)}`))
      .then((res) => {
        if (current) {
          setTrace(res.data as TraceDetail);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (current) {
          setError(e instanceof Error ? e.message : "Failed to load trace");
        }
      });
    return () => {
      current = false;
    };
  }, [http, api, traceId]);

  // The trace last loaded may belong to the previous selection: shown only
  // once it matches, never while the new one is on its way.
  return {
    trace: trace && trace.traceId === traceId ? trace : undefined,
    error,
  };
};
