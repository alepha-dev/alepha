import { useClient } from "alepha/react";
import {
  AlertCircle,
  ChevronRight,
  Clock,
  Gauge,
  Hourglass,
  Loader2,
  Play,
  RefreshCcw,
  Repeat,
  Timer,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PlaygroundController } from "../../api/PlaygroundController.ts";
import { useToast } from "./Toaster.tsx";

export interface JobRowJob {
  name: string;
  description?: string;
  type: "cron" | "queue";
  cron?: string;
  priority: "critical" | "high" | "normal" | "low";
  timeout?: string;
  retry?: { retries: number; hasBackoff: boolean };
  recent: { ok: number; error: number; lastRun?: string };
}

interface Execution {
  id: string;
  status: "pending" | "running" | "scheduled" | "ok" | "error" | "cancelled";
  attempt: number;
  maxAttempts: number;
  startedAt?: string;
  completedAt?: string;
  scheduledAt?: string;
  priority: number;
  error?: string;
  payload?: Record<string, unknown>;
  key?: string | null;
  can: { retry: boolean; cancel: boolean };
}

interface JobRowProps {
  job: JobRowJob;
  onRunClick: () => void;
  onExecutionChanged: () => void;
}

export const JobRow = (props: JobRowProps) => {
  const client = useClient<PlaygroundController>();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [execs, setExecs] = useState<Execution[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await client.playgroundListExecutions({
        params: { name: props.job.name },
        query: {},
      });
      setExecs(data as Execution[]);
    } finally {
      setLoading(false);
    }
  }, [client, props.job.name]);

  useEffect(() => {
    if (!expanded) return;
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => clearInterval(id);
  }, [expanded, load]);

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        await client.cancelAny({ params: { id } });
        toast.success("Cancelled");
        await load();
        props.onExecutionChanged();
      } catch (e) {
        toast.error(`Cancel failed: ${e instanceof Error ? e.message : e}`);
      }
    },
    [client, load, props, toast],
  );

  const handleRetry = useCallback(
    async (id: string) => {
      try {
        await client.retryAny({ params: { id } });
        toast.success("Retry queued");
        await load();
        props.onExecutionChanged();
      } catch (e) {
        toast.error(`Retry failed: ${e instanceof Error ? e.message : e}`);
      }
    },
    [client, load, props, toast],
  );

  const toggleExpand = () => setExpanded((v) => !v);

  return (
    <div className="border-b border-[var(--color-border-soft)] last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpand();
          }
        }}
        className="grid w-full cursor-pointer grid-cols-[1fr_70px_140px_100px_50px_50px_100px] items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--color-surface-2)]/60 focus:bg-[var(--color-surface-2)]/60 focus:outline-none"
      >
        <div className="flex min-w-0 flex-col gap-0">
          <span className="flex items-center gap-1.5 truncate text-[var(--color-fg)]">
            <Chevron open={expanded} />
            <span className="font-medium">{props.job.name}</span>
          </span>
          {props.job.description && (
            <span className="truncate pl-3.5 text-[11px] text-[var(--color-fg-muted)]">
              {props.job.description}
            </span>
          )}
        </div>
        <TypeBadge type={props.job.type} />
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">
          {props.job.cron ?? "—"}
        </span>
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {props.job.recent.lastRun
            ? formatRelative(props.job.recent.lastRun)
            : "never"}
        </span>
        <span
          className={`text-right font-mono text-[12px] ${props.job.recent.ok > 0 ? "text-[var(--color-success)]" : "text-[var(--color-fg-dim)]"}`}
        >
          {props.job.recent.ok}
        </span>
        <span
          className={`text-right font-mono text-[12px] ${props.job.recent.error > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-fg-dim)]"}`}
        >
          {props.job.recent.error}
        </span>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onRunClick();
            }}
            className="flex items-center gap-1 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
          >
            <Play size={10} strokeWidth={2.5} className="fill-current" />
            Run
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
          <Meta job={props.job} />
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-fg-muted)]">
            Last executions
          </div>
          <div className="mt-1.5">
            {loading && !execs ? (
              <Empty text="Loading…" />
            ) : !execs || execs.length === 0 ? (
              <Empty text="No executions yet." />
            ) : (
              <ExecTable
                execs={execs}
                onCancel={handleCancel}
                onRetry={handleRetry}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Chevron = (props: { open: boolean }) => (
  <ChevronRight
    size={13}
    strokeWidth={2.25}
    className="shrink-0 text-[var(--color-fg-dim)] transition-transform"
    style={{ transform: props.open ? "rotate(90deg)" : "rotate(0deg)" }}
  />
);

const TypeBadge = (props: { type: "cron" | "queue" }) => (
  <span
    className={[
      "inline-flex w-fit items-center rounded border px-1.5 py-[1px] text-[10px] font-medium uppercase",
      props.type === "cron"
        ? "border-[var(--color-info)]/40 bg-[var(--color-info-soft)] text-[var(--color-info)]"
        : "border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    ].join(" ")}
  >
    {props.type}
  </span>
);

const Meta = (props: { job: JobRowJob }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] md:grid-cols-4">
    <MetaItem label="Priority" icon={Gauge} value={props.job.priority} />
    <MetaItem
      label="Timeout"
      icon={Hourglass}
      value={props.job.timeout ?? "—"}
    />
    <MetaItem
      label="Retries"
      icon={Repeat}
      value={
        props.job.retry
          ? `${props.job.retry.retries}${props.job.retry.hasBackoff ? " + backoff" : ""}`
          : "—"
      }
    />
    <MetaItem
      label="Schedule"
      icon={Clock}
      value={props.job.cron ?? "—"}
      mono
    />
  </div>
);

const MetaItem = (props: {
  label: string;
  value: string;
  icon: typeof Clock;
  mono?: boolean;
}) => {
  const Icon = props.icon;
  return (
    <div className="flex flex-col gap-0">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.05em] text-[var(--color-fg-dim)]">
        <Icon size={10} strokeWidth={2.25} />
        {props.label}
      </span>
      <span
        className={`text-[12px] text-[var(--color-fg-soft)] ${props.mono ? "font-mono" : ""}`}
      >
        {props.value}
      </span>
    </div>
  );
};

const Empty = (props: { text: string }) => (
  <div className="flex items-center justify-center gap-2 rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/50 px-3 py-2 text-[11px] text-[var(--color-fg-dim)]">
    {props.text === "Loading…" ? (
      <Loader2 size={12} strokeWidth={2} className="animate-spin" />
    ) : (
      <AlertCircle size={12} strokeWidth={2} />
    )}
    {props.text}
  </div>
);

interface ExecTableProps {
  execs: Execution[];
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
}

const ExecTable = (props: ExecTableProps) => (
  <div className="overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-[var(--color-surface-2)] text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-fg-muted)]">
          <th className="px-2.5 py-1.5">Status</th>
          <th className="px-2.5 py-1.5">Attempt</th>
          <th className="px-2.5 py-1.5">Started / scheduled</th>
          <th className="px-2.5 py-1.5">Duration</th>
          <th className="px-2.5 py-1.5">Error</th>
          <th className="px-2.5 py-1.5 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {props.execs.map((e) => (
          <tr
            key={e.id}
            className="border-t border-[var(--color-border-soft)] align-top"
          >
            <td className="px-2.5 py-1.5">
              <StatusPill status={e.status} />
            </td>
            <td className="px-2.5 py-1.5 font-mono text-[var(--color-fg-soft)]">
              {e.attempt}/{e.maxAttempts}
            </td>
            <td className="px-2.5 py-1.5 font-mono text-[var(--color-fg-muted)]">
              <span className="inline-flex items-center gap-1">
                {e.scheduledAt && !e.completedAt ? (
                  <Timer size={10} strokeWidth={2.25} />
                ) : null}
                {e.startedAt
                  ? formatRelative(e.startedAt)
                  : e.scheduledAt
                    ? `in ${formatUntil(e.scheduledAt)}`
                    : "—"}
              </span>
            </td>
            <td className="px-2.5 py-1.5 font-mono text-[var(--color-fg-muted)]">
              {formatDuration(e.startedAt, e.completedAt)}
            </td>
            <td
              className={`max-w-[280px] truncate px-2.5 py-1.5 ${e.error ? "text-[var(--color-danger)]" : "text-[var(--color-fg-dim)]"}`}
              title={e.error ?? ""}
            >
              {e.error ?? "—"}
            </td>
            <td className="px-2.5 py-1.5">
              <div className="flex justify-end gap-1">
                {e.can.retry && (
                  <button
                    type="button"
                    onClick={() => props.onRetry(e.id)}
                    className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-soft)] hover:border-[var(--color-fg-muted)]"
                  >
                    <RefreshCcw size={9} strokeWidth={2.5} />
                    Retry
                  </button>
                )}
                {e.can.cancel && (
                  <button
                    type="button"
                    onClick={() => props.onCancel(e.id)}
                    className="flex items-center gap-1 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20"
                  >
                    <X size={9} strokeWidth={2.5} />
                    Cancel
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const STATUS_STYLES: Record<string, string> = {
  pending:
    "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-soft)]",
  running:
    "border-[var(--color-info)]/40 bg-[var(--color-info-soft)] text-[var(--color-info)]",
  scheduled:
    "border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  ok: "border-[var(--color-success)]/40 bg-[var(--color-success-soft)] text-[var(--color-success)]",
  error:
    "border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  cancelled:
    "border-[var(--color-fg-dim)]/40 bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
};

const StatusPill = (props: { status: string }) => (
  <span
    className={`inline-flex rounded border px-1.5 py-[1px] text-[10px] font-medium uppercase ${STATUS_STYLES[props.status] ?? ""}`}
  >
    {props.status}
  </span>
);

function formatRelative(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 1000) return "just now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function formatUntil(iso: string): string {
  const d = new Date(iso).getTime() - Date.now();
  if (d <= 0) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h`;
}

function formatDuration(start?: string, end?: string): string {
  if (!start || !end) return "—";
  const d = new Date(end).getTime() - new Date(start).getTime();
  if (d < 0) return "—";
  if (d < 1000) return `${d}ms`;
  if (d < 60_000) return `${(d / 1000).toFixed(1)}s`;
  return `${Math.floor(d / 60_000)}m${Math.floor((d % 60_000) / 1000)}s`;
}
