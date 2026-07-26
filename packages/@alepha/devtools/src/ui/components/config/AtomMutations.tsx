import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useState } from "react";
import { collapse } from "./collapseValue.ts";

export interface AtomMutationsProps {
  atomName: string;
}

interface MutationEntry {
  key: string;
  value: unknown;
  prevValue: unknown;
  at: number;
}

/**
 * Recent writes to this atom, from the dev-only mutation ring buffer.
 *
 * Shows `previous → next`: the buffer has always recorded `prevValue`, and a
 * mutation list that only shows the new value can't tell you what actually
 * changed.
 */
export const AtomMutations = (props: AtomMutationsProps) => {
  const http = useInject(HttpClient);
  const [entries, setEntries] = useState<MutationEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      http
        .fetch(
          `/__devtools/api/atoms/log?key=${encodeURIComponent(props.atomName)}`,
        )
        .then((res) => {
          if (!cancelled) {
            setEntries((res.data as any)?.entries ?? []);
            setError(null);
          }
        })
        .catch((e) => {
          // Never swallow: a failed fetch would otherwise render as "no recent
          // mutations", which is indistinguishable from a healthy idle atom.
          if (!cancelled) setError(e?.message ?? "Failed to load mutations");
        });

    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [http, props.atomName]);

  if (error) {
    return (
      <>
        <div className="dt-section-label">
          Recent mutations
          <span className="dt-live-dot" />
        </div>
        <div style={{ padding: 14, fontSize: 11, color: "var(--dt-error)" }}>
          {error}
        </div>
      </>
    );
  }

  if (entries.length === 0) return null;

  return (
    <>
      <div className="dt-section-label">
        Recent mutations
        <span className="dt-live-dot" />
      </div>
      <div>
        {entries.map((entry, i) => (
          <div
            key={`${entry.at}-${i}`}
            style={{
              display: "flex",
              gap: 10,
              padding: "4px 14px",
              fontSize: 11,
              borderBottom: "1px solid var(--dt-border-soft)",
            }}
          >
            <span
              className="dt-mono"
              style={{ color: "var(--dt-fg-faint)", flex: "none" }}
            >
              {new Date(entry.at).toLocaleTimeString()}
            </span>
            {/*
             * New value first, then what it replaced. The list is read
             * newest-first down the page, so leading each row with the
             * outcome lets you scan one column instead of two.
             */}
            <span className="dt-mono dt-atom-value">
              {collapse(entry.value)}
            </span>
            <span style={{ color: "var(--dt-fg-faint)" }}>←</span>
            <span className="dt-mono" style={{ color: "var(--dt-fg-faint)" }}>
              {collapse(entry.prevValue)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
};
