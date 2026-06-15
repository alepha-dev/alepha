import { useEffect, useState } from "react";

/**
 * Fetch the configured sigil's `excludedPaths` from the same-origin
 * `/api/sigil/config` proxy once on mount.
 *
 * The proxy resolves the glob list server-side from the sigil id (a server
 * secret that never reaches the browser) — only the non-secret pattern list
 * crosses the wire. Best-effort: any failure (offline, disabled provider,
 * non-OK response) leaves the list empty, so the embed is simply never
 * suppressed rather than erroring.
 */
export const useSigilExcludedPaths = (): string[] => {
  const [excludedPaths, setExcludedPaths] = useState<string[]>([]);

  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;
    fetch("/api/sigil/config", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && Array.isArray(data.excludedPaths)) {
          setExcludedPaths(data.excludedPaths);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return excludedPaths;
};
