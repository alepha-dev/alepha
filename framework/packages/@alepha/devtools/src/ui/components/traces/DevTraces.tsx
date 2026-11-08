import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { useMemo } from "react";

import { useRelativeTime } from "../../hooks/useRelativeTime.ts";
import { useTraces } from "../../hooks/useTraces.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { TraceWaterfall } from "./TraceWaterfall.tsx";

const querySchema = z.object({
  trace: z.text().optional(),
  span: z.text().optional(),
  errors: z.text().optional(),
});

/**
 * The run's recent traces, and one of them as a waterfall.
 *
 * Every request, job run, cron tick and message the app handled opens a
 * trace; the run keeps the last two hundred in memory.
 */
export const DevTraces = () => {
  const { traces, available, error } = useTraces();
  const relative = useRelativeTime({ fallback: "unknown" });
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });

  const errorsOnly = params.errors === "1";
  const visible = useMemo(
    () => traces.filter((t) => !errorsOnly || t.status === "error"),
    [traces, errorsOnly],
  );

  if (available === false) {
    return (
      <DevEmpty
        title="This run does not trace"
        hint="Its alepha predates built-in tracing."
      />
    );
  }
  if (error && traces.length === 0) {
    return <DevError what="traces" message={error} />;
  }
  if (available && traces.length === 0) {
    return (
      <DevEmpty
        title="No traces yet"
        hint="Send the app a request, or run a job: each one opens a trace."
      />
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <div className="dt-rail" style={{ width: 340 }}>
        <div className="dt-section-label" style={{ borderTop: 0 }}>
          Recent
          <span style={{ letterSpacing: 0 }}>· {traces.length}</span>
          <span className="dt-seg" style={{ marginLeft: "auto" }}>
            {[
              { value: undefined, label: "All" },
              { value: "1", label: "Errors" },
            ].map((f) => (
              <button
                key={f.label}
                type="button"
                className="dt-seg-item"
                data-on={params.errors === f.value || undefined}
                onClick={() => setParams({ ...params, errors: f.value })}
              >
                {f.label}
              </button>
            ))}
          </span>
        </div>

        <div className="dt-rail-body">
          {visible.map((t) => (
            <button
              key={t.traceId}
              type="button"
              className="dt-leaf"
              style={{ paddingLeft: 12, gap: 6 }}
              data-active={params.trace === t.traceId || undefined}
              onClick={() =>
                setParams({ ...params, trace: t.traceId, span: undefined })
              }
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  flex: "none",
                  background:
                    t.status === "error" ? "var(--dt-error)" : "var(--dt-get)",
                }}
              />
              <span
                className="dt-mono"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.name}
              </span>
              <span className="dt-nav-count" style={{ marginLeft: "auto" }}>
                {t.duration} ms · {t.spanCount} · {relative(t.startTime)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="dt-detail">
        {params.trace ? (
          <TraceWaterfall
            traceId={params.trace}
            selectedSpan={params.span}
            onSelectSpan={(span) => setParams({ ...params, span })}
          />
        ) : (
          <DevEmpty title="Select a trace" />
        )}
      </div>
    </div>
  );
};

export default DevTraces;
