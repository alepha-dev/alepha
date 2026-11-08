import type { TraceLogLine, TraceSpan } from "../../hooks/useTraces.ts";
import { DetailFields } from "../declared/DetailFields.tsx";

export interface TraceSpanDetailProps {
  span: TraceSpan;
  /**
   * The log lines logged while this span was active, matched by `spanId`.
   */
  logs: TraceLogLine[];
}

/**
 * One span of the waterfall: its timing, status, attributes and log lines.
 */
export const TraceSpanDetail = (props: TraceSpanDetailProps) => {
  const span = props.span;
  const attributes = Object.entries(span.attributes);

  return (
    <div>
      <div className="dt-section-label">Span · {span.name}</div>
      <DetailFields
        fields={[
          { label: "Kind", value: span.kind },
          { label: "Duration", value: `${span.duration ?? 0} ms` },
          {
            label: "Status",
            value:
              span.status === "error"
                ? `error${span.statusMessage ? `: ${span.statusMessage}` : ""}`
                : span.status,
          },
          {
            label: "Exception",
            value: span.exception
              ? `${span.exception.type}: ${span.exception.message}`
              : undefined,
          },
          {
            label: "N+1",
            value: span.nPlusOne
              ? `${span.nPlusOne.count} × ${span.nPlusOne.name} under this span`
              : undefined,
          },
          { label: "Span id", value: span.spanId },
          { label: "Parent", value: span.parentSpanId },
          {
            label: "Linked from",
            value: span.links.length
              ? span.links.map((l) => `${l.traceId}/${l.spanId}`).join(", ")
              : undefined,
          },
        ]}
      />

      {attributes.length > 0 && (
        <>
          <div className="dt-section-label">Attributes</div>
          <DetailFields
            fields={attributes.map(([key, value]) => ({
              label: key,
              value: String(value),
            }))}
          />
        </>
      )}

      <div className="dt-section-label">
        Logs
        <span style={{ letterSpacing: 0 }}>· {props.logs.length}</span>
      </div>
      {props.logs.length === 0 ? (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 11,
            color: "var(--dt-fg-faint)",
          }}
        >
          Nothing logged inside this span.
        </div>
      ) : (
        <pre className="dt-pre" style={{ whiteSpace: "pre-wrap" }}>
          {props.logs
            .map(
              (l) =>
                `${l.level.padEnd(5)} ${l.module}.${l.service}: ${l.message}`,
            )
            .join("\n")}
        </pre>
      )}
    </div>
  );
};
