import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { JobExecution } from "../../hooks/useJobs.ts";

const STATUS_COLOR: Record<string, string> = {
  ok: "var(--dt-get)",
  completed: "var(--dt-get)",
  running: "var(--dt-info)",
  pending: "var(--dt-warn)",
  error: "var(--dt-error)",
  failed: "var(--dt-error)",
  cancelled: "var(--dt-fg-faint)",
};

const LEVEL_COLOR: Record<string, string> = {
  INFO: "var(--dt-info)",
  DEBUG: "var(--dt-debug)",
  WARN: "var(--dt-warn)",
  ERROR: "var(--dt-error)",
};

const relative = (value?: string | number): string => {
  if (!value) return "—";
  const ts = typeof value === "number" ? value : Date.parse(String(value));
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

const clock = (value?: string | number): string => {
  if (!value) return "—";
  const ts = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isNaN(ts) ? "—" : new Date(ts).toLocaleTimeString();
};

const duration = (row: JobExecution): string => {
  const a = row.startedAt
    ? typeof row.startedAt === "number"
      ? row.startedAt
      : Date.parse(String(row.startedAt))
    : undefined;
  const b = row.completedAt
    ? typeof row.completedAt === "number"
      ? row.completedAt
      : Date.parse(String(row.completedAt))
    : undefined;
  if (!a || !b || Number.isNaN(a) || Number.isNaN(b)) return "—";
  const ms = b - a;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

export interface JobExecutionsProps {
  jobName: string;
  /**
   * Whether the job persists executions at all — `record: "none"` means this
   * table is empty by design, not because nothing ran.
   */
  record?: string;
}

export const JobExecutions = (props: JobExecutionsProps) => {
  const http = useInject(HttpClient);
  const [rows, setRows] = useState<JobExecution[]>([]);
  const [selected, setSelected] = useState<JobExecution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await http.fetch(
        `/__devtools/api/jobs/${encodeURIComponent(props.jobName)}/executions`,
      );
      const data = res.data as any;
      setRows(
        (data?.content ?? data?.executions ?? data ?? []) as JobExecution[],
      );
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load executions");
    }
  }, [http, props.jobName]);

  useEffect(() => {
    setSelected(null);
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const retry = async (row: JobExecution) => {
    setBusy(true);
    try {
      await http.fetch(
        `/__devtools/api/jobs/executions/${encodeURIComponent(row.id)}/retry`,
        { method: "POST" },
      );
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Retry failed");
    } finally {
      setBusy(false);
    }
  };

  const logs = Array.isArray(selected?.logs) ? (selected?.logs as any[]) : [];

  return (
    <div>
      <div className="dt-section-label">
        Recent executions
        {props.record && (
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            record: {props.record}
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 11,
            color: "var(--dt-error)",
          }}
        >
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          style={{ padding: "14px", fontSize: 11, color: "var(--dt-fg-faint)" }}
        >
          {props.record === "none"
            ? "This job records no executions (record: none)."
            : "No executions recorded yet."}
        </div>
      ) : (
        <table className="dt-table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>ID</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 50 }}>Try</th>
              <th style={{ width: 80 }}>Duration</th>
              <th style={{ width: 90 }}>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="dt-row-click"
                data-active={selected?.id === row.id || undefined}
                onClick={() =>
                  setSelected(selected?.id === row.id ? null : row)
                }
              >
                <td>{String(row.id).slice(0, 10)}</td>
                <td style={{ color: STATUS_COLOR[row.status] ?? undefined }}>
                  {row.status}
                </td>
                <td>{row.attempt ?? "—"}</td>
                <td>{duration(row)}</td>
                <td>{clock(row.startedAt ?? row.createdAt)}</td>
                <td style={{ textAlign: "right", color: "var(--dt-fg-faint)" }}>
                  {relative(row.startedAt ?? row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div
          style={{
            margin: 14,
            border: "1px solid var(--dt-border)",
            background: "var(--dt-panel)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderBottom: "1px solid var(--dt-border)",
            }}
          >
            <span className="dt-mono" style={{ fontSize: 11 }}>
              {String(selected.id).slice(0, 10)}
            </span>
            <span
              className="dt-chip"
              style={{ color: STATUS_COLOR[selected.status] }}
            >
              {selected.status}
            </span>
            <span style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}>
              attempt {selected.attempt}
            </span>
            {selected.can?.retry !== false && (
              <button
                type="button"
                className="dt-btn"
                style={{ marginLeft: "auto" }}
                disabled={busy}
                onClick={() => retry(selected)}
              >
                <RotateCcw size={11} /> Retry
              </button>
            )}
          </div>

          {selected.payload !== undefined && selected.payload !== null && (
            <>
              <div className="dt-section-label">Payload</div>
              <pre className="dt-pre">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </>
          )}

          {selected.error && (
            <>
              <div className="dt-section-label">Error</div>
              <pre className="dt-pre" style={{ color: "var(--dt-error)" }}>
                {selected.error}
              </pre>
            </>
          )}

          {logs.length > 0 && (
            <>
              <div className="dt-section-label">Captured logs</div>
              <div style={{ padding: "8px 14px" }}>
                {logs.map((line: any, i: number) => (
                  <div
                    key={i}
                    className="dt-mono"
                    style={{ fontSize: 10, lineHeight: 1.8 }}
                  >
                    <span style={{ color: "var(--dt-fg-faint)" }}>
                      {clock(line.at ?? line.timestamp)}{" "}
                    </span>
                    <span
                      style={{ color: LEVEL_COLOR[line.level] ?? undefined }}
                    >
                      {line.level}{" "}
                    </span>
                    <span>{line.message ?? String(line)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
