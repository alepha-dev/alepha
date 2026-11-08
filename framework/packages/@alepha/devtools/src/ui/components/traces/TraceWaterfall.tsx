import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import { type TraceSpan, useTrace } from "../../hooks/useTraces.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { TraceSpanDetail } from "./TraceSpanDetail.tsx";

export interface TraceWaterfallProps {
  traceId: string;
  selectedSpan?: string;
  onSelectSpan: (spanId: string) => void;
}

/**
 * One trace as a waterfall: a row per span, indented under its parent, each
 * bar placed on the trace's own timeline. A parent with five or more
 * same-name children (an N+1) carries a warning.
 */
export const TraceWaterfall = (props: TraceWaterfallProps) => {
  const { trace, error } = useTrace(props.traceId);

  const rows = useMemo(() => {
    if (!trace) return [];
    return orderSpans(trace.spans);
  }, [trace]);

  if (error) {
    return <DevError what="this trace" message={error} />;
  }
  if (!trace) {
    return null;
  }
  if (rows.length === 0) {
    return (
      <DevEmpty
        title="Trace gone"
        hint="The run keeps its last two hundred traces; this one was dropped."
      />
    );
  }

  const start = Math.min(...rows.map((r) => r.span.startTime));
  const end = Math.max(...rows.map((r) => r.span.endTime ?? r.span.startTime));
  const total = Math.max(1, end - start);
  const selected = rows.find((r) => r.span.spanId === props.selectedSpan)?.span;
  const root = rows[0].span;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 14px 10px",
        }}
      >
        <span className="dt-mono" style={{ fontSize: 14 }}>
          {root.name}
        </span>
        <span className="dt-chip">{end - start} ms</span>
        <span className="dt-chip">{rows.length} spans</span>
        <span
          className="dt-mono"
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "var(--dt-fg-faint)",
          }}
        >
          {props.traceId}
        </span>
      </div>

      <div className="dt-section-label">Waterfall</div>
      <div style={{ padding: "4px 0" }}>
        {rows.map(({ span, depth }) => {
          const left = ((span.startTime - start) / total) * 100;
          const width = Math.max(
            0.5,
            (((span.endTime ?? span.startTime) - span.startTime) / total) * 100,
          );
          const failed = span.status === "error";
          return (
            <button
              key={span.spanId}
              type="button"
              className="dt-leaf"
              data-active={props.selectedSpan === span.spanId || undefined}
              onClick={() => props.onSelectSpan(span.spanId)}
              style={{ display: "flex", gap: 8, paddingLeft: 12 }}
            >
              <span
                className="dt-mono"
                style={{
                  width: 280,
                  flex: "none",
                  paddingLeft: depth * 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: failed ? "var(--dt-error)" : undefined,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {span.nPlusOne && (
                  <AlertTriangle
                    size={11}
                    style={{ color: "var(--dt-warn)", flex: "none" }}
                    aria-label={`N+1: ${span.nPlusOne.count} × ${span.nPlusOne.name}`}
                  />
                )}
                {span.name}
              </span>
              <span
                style={{
                  position: "relative",
                  flex: 1,
                  height: 10,
                  alignSelf: "center",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 0,
                    bottom: 0,
                    borderRadius: 2,
                    background: failed
                      ? "var(--dt-error)"
                      : span.kind === "client"
                        ? "var(--dt-info)"
                        : "var(--dt-accent)",
                  }}
                />
              </span>
              <span
                className="dt-nav-count"
                style={{ width: 56, flex: "none", textAlign: "right" }}
              >
                {span.duration ?? 0} ms
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <TraceSpanDetail
          span={selected}
          logs={trace.logs.filter((l) => l.spanId === selected.spanId)}
        />
      )}
    </div>
  );
};

/**
 * Spans in waterfall order: depth first from the roots, siblings by start
 * time. A span whose parent is not in this trace (a continued trace's root)
 * is a root here.
 */
const orderSpans = (
  spans: TraceSpan[],
): Array<{ span: TraceSpan; depth: number }> => {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string, TraceSpan[]>();
  const roots: TraceSpan[] = [];
  for (const span of spans) {
    if (span.parentSpanId && ids.has(span.parentSpanId)) {
      const list = children.get(span.parentSpanId) ?? [];
      list.push(span);
      children.set(span.parentSpanId, list);
    } else {
      roots.push(span);
    }
  }
  const out: Array<{ span: TraceSpan; depth: number }> = [];
  const walk = (span: TraceSpan, depth: number) => {
    out.push({ span, depth });
    const kids = (children.get(span.spanId) ?? []).toSorted(
      (a, b) => a.startTime - b.startTime,
    );
    for (const kid of kids) walk(kid, depth + 1);
  };
  for (const root of roots.toSorted((a, b) => a.startTime - b.startTime)) {
    walk(root, 0);
  }
  return out;
};
