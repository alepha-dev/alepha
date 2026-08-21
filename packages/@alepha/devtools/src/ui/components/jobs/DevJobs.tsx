import { z } from "alepha";
import { useInject } from "alepha/react";
import { useQueryParams } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { Play } from "lucide-react";
import { useMemo, useState } from "react";

import type { DevJobMetadata } from "../../../schemas/DevJobMetadata.ts";
import { type JobRuntime, useJobs } from "../../hooks/useJobs.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { describeCron } from "../declared/describeCron.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { SchemaTree } from "../shared/SchemaTree.tsx";
import { JobExecutions } from "./JobExecutions.tsx";

const querySchema = z.object({ selected: z.text().optional() });

const MODE_COLOR: Record<string, string> = {
  cron: "var(--dt-patch)",
  queue: "var(--dt-info)",
  direct: "var(--dt-get)",
};

const relative = (value?: string): string => {
  if (!value) return "never";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

interface StatProps {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}

const Stat = (props: StatProps) => (
  <div
    style={{
      flex: "1 1 200px",
      minWidth: 180,
      padding: "10px 14px",
      borderRight: "1px solid var(--dt-border-soft)",
      borderBottom: "1px solid var(--dt-border-soft)",
    }}
  >
    <div
      style={{
        fontSize: 9,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--dt-fg-faint)",
      }}
    >
      {props.label}
    </div>
    <div
      className="dt-mono"
      style={{ fontSize: 13, color: props.tone ?? "var(--dt-fg)" }}
    >
      {props.value}
    </div>
    <div style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}>
      {props.hint}
    </div>
  </div>
);

/**
 * Jobs declared with `$job` — the one primitive where runtime state is
 * legitimately available, because `$job` persists every execution to a durable
 * outbox table. Everything else in devtools is static reflection.
 */
export const DevJobs = () => {
  const meta = useMetadata();
  const runtime = useJobs();
  const http = useInject(HttpClient);
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [payloadText, setPayloadText] = useState("{}");

  const declared: DevJobMetadata[] = meta.data?.jobs ?? [];

  /**
   * The declaration is the source of truth for what exists; the runtime row
   * adds counts and effective mode (a queue job runs `direct` when no queue
   * infrastructure is loaded, which is worth seeing).
   */
  const jobs = useMemo(
    () =>
      declared.map((job) => ({
        declared: job,
        runtime: runtime.jobs.find((r) => r.name === job.name) as
          | JobRuntime
          | undefined,
      })),
    [declared, runtime.jobs],
  );

  const current = jobs.find((j) => j.declared.name === params.selected);

  /**
   * A skeleton payload from the declared schema, so the editor opens with the
   * required keys rather than an empty object the server will reject.
   */
  const skeleton = (schema: any): string => {
    const props = schema?.properties ?? {};
    const required: string[] = schema?.required ?? Object.keys(props);
    const out: Record<string, unknown> = {};
    for (const key of required) {
      const p = props[key] ?? {};
      if (Array.isArray(p.enum)) out[key] = p.enum[0];
      else if (p.default !== undefined) out[key] = p.default;
      else if (p.type === "integer" || p.type === "number") out[key] = 0;
      else if (p.type === "boolean") out[key] = false;
      else if (p.type === "array") out[key] = [];
      else if (p.type === "object") out[key] = {};
      else out[key] = "";
    }
    return JSON.stringify(out, null, 2);
  };

  const send = async (payload: unknown) => {
    if (!current) return;
    setPushing(true);
    setPushResult(null);
    try {
      await http.fetch(
        `/__devtools/api/jobs/${encodeURIComponent(current.declared.name)}/trigger`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setPushResult("Triggered");
      setPayloadOpen(false);
      void runtime.reload();
    } catch (e: any) {
      setPushResult(e?.message ?? "Trigger failed");
    } finally {
      setPushing(false);
    }
  };

  /**
   * Cron jobs take no payload, so they fire immediately. Queue jobs are
   * rejected server-side without one — the editor opens instead, prefilled
   * from the schema shown further down the page.
   */
  const onTrigger = () => {
    if (!current) return;
    if (current.declared.mode === "queue") {
      setPayloadText(skeleton(current.declared.schema));
      setPayloadOpen(true);
      setPushResult(null);
      return;
    }
    void send({});
  };

  if (meta.error) {
    return <DevError what="jobs" message={meta.error} onRetry={meta.reload} />;
  }

  if (!meta.loading && declared.length === 0) {
    return (
      <DevEmpty
        title="No jobs declared"
        hint="Use $job to declare cron or queue work"
      />
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div className="dt-rail" style={{ width: 280 }}>
        <div className="dt-section-label" style={{ borderTop: 0 }}>
          Registered jobs
        </div>
        <div className="dt-rail-body">
          {jobs.map(({ declared: job, runtime: r }) => (
            <button
              key={job.name}
              type="button"
              className="dt-leaf"
              style={{
                paddingLeft: 12,
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
              }}
              data-active={params.selected === job.name || undefined}
              onClick={() => setParams({ selected: job.name })}
            >
              <span className="dt-mono" style={{ width: "100%" }}>
                {job.name}
              </span>
              <span
                style={{
                  display: "flex",
                  gap: 8,
                  width: "100%",
                  fontSize: 9,
                  fontFamily: "var(--dt-mono)",
                }}
              >
                <span style={{ color: MODE_COLOR[r?.type ?? job.mode] }}>
                  {(r?.type ?? job.mode).toUpperCase()}
                </span>
                <span
                  style={{ marginLeft: "auto", color: "var(--dt-fg-faint)" }}
                >
                  {/*
                   * A job that has never run reads "never run", not "0 ok" —
                   * zero successes and zero failures is not a health signal,
                   * and rendering it as one makes an idle job look like a
                   * broken one.
                   */}
                  {r &&
                    (r.recent.ok === 0 && r.recent.error === 0 ? (
                      "never run"
                    ) : (
                      <>
                        {r.recent.ok > 0 && `${r.recent.ok} ok`}
                        {r.recent.error > 0 && (
                          <span style={{ color: "var(--dt-error)" }}>
                            {r.recent.ok > 0 ? " " : ""}
                            {r.recent.error} err
                          </span>
                        )}
                      </>
                    ))}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--dt-border-soft)",
            fontSize: 9,
            color: "var(--dt-fg-faint)",
          }}
        >
          Counts are recent execution rows, not live queue depth.
        </div>
      </div>

      <div className="dt-detail">
        {!current ? (
          <DevEmpty title="Select a job" />
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 14px 6px",
              }}
            >
              <span className="dt-mono" style={{ fontSize: 14 }}>
                {current.declared.name}
              </span>
              <span
                className="dt-chip"
                style={{
                  color:
                    MODE_COLOR[current.runtime?.type ?? current.declared.mode],
                }}
              >
                {(current.runtime?.type ?? current.declared.mode).toUpperCase()}
              </span>
              <button
                type="button"
                className="dt-btn"
                data-variant="primary"
                style={{ marginLeft: "auto" }}
                disabled={pushing}
                onClick={onTrigger}
              >
                <Play size={11} />
                {current.declared.mode === "cron" ? "Run now" : "Push payload"}
              </button>
            </div>

            {payloadOpen && (
              <div style={{ padding: "0 14px 12px" }}>
                <textarea
                  className="dt-input dt-mono"
                  style={{ height: 130, padding: 8, resize: "vertical" }}
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.currentTarget.value)}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className="dt-btn"
                    data-variant="primary"
                    disabled={pushing}
                    onClick={() => {
                      try {
                        void send(JSON.parse(payloadText));
                      } catch {
                        setPushResult("Payload is not valid JSON");
                      }
                    }}
                  >
                    {pushing ? "Pushing…" : "Push"}
                  </button>
                  <button
                    type="button"
                    className="dt-btn"
                    onClick={() => setPayloadOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {current.declared.description && (
              <div
                style={{
                  padding: "0 14px 10px",
                  fontSize: 12,
                  color: "var(--dt-fg-dim)",
                }}
              >
                {current.declared.description}
              </div>
            )}

            {pushResult && (
              <div
                style={{
                  padding: "0 14px 10px",
                  fontSize: 11,
                  color:
                    pushResult === "Pushed"
                      ? "var(--dt-get)"
                      : "var(--dt-error)",
                }}
              >
                {pushResult}
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                borderTop: "1px solid var(--dt-border-soft)",
              }}
            >
              <Stat
                label="Mode"
                value={current.runtime?.type ?? current.declared.mode}
                hint={
                  current.declared.mode === "cron"
                    ? "scheduled tick"
                    : current.runtime?.type === "direct"
                      ? "in-process — no queue loaded"
                      : "outbox + queue consumer"
                }
                tone={
                  MODE_COLOR[current.runtime?.type ?? current.declared.mode]
                }
              />
              {current.declared.cron && (
                <Stat
                  label="Cron"
                  value={current.declared.cron}
                  hint={
                    describeCron(current.declared.cron) ?? "custom schedule"
                  }
                />
              )}
              <Stat
                label="Priority"
                value={
                  current.runtime?.priority ??
                  current.declared.priority ??
                  "normal"
                }
                hint="sweep ordering under backlog"
              />
              <Stat
                label="Timeout"
                value={current.declared.timeout ?? "none"}
                hint="per attempt · handler gets AbortSignal"
              />
              <Stat
                label="Retry"
                value={
                  current.declared.mode === "cron"
                    ? "—"
                    : `${current.declared.retries ?? 0}×`
                }
                hint={
                  current.declared.mode === "cron"
                    ? "cron does not retry — next tick re-runs"
                    : "picked up by the sweep"
                }
              />
              <Stat
                label="Last run"
                value={relative(current.runtime?.recent.lastRun)}
                hint={`record: ${current.declared.record ?? "default"}`}
              />
              {current.declared.lock !== undefined && (
                <Stat
                  label="Lock"
                  value={current.declared.lock ? "yes" : "no"}
                  hint="single replica runs the tick"
                />
              )}
            </div>

            {current.declared.schema && (
              <SchemaTree
                schema={current.declared.schema}
                label="Payload schema"
                rootName="payload"
              />
            )}

            <JobExecutions
              jobName={current.declared.name}
              record={current.declared.record}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default DevJobs;
