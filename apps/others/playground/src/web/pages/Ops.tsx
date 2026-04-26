import { useClient } from "alepha/react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PlaygroundController } from "../../api/PlaygroundController.ts";
import { JobRow, type JobRowJob } from "../components/JobRow.tsx";
import { RunJobDialog } from "../components/RunJobDialog.tsx";
import { useToast } from "../components/Toaster.tsx";

const POLL_MS = 5000;

const Ops = () => {
  const client = useClient<PlaygroundController>();
  const toast = useToast();
  const [jobs, setJobs] = useState<JobRowJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runTarget, setRunTarget] = useState<JobRowJob | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await client.playgroundListJobs();
      setJobs(data as JobRowJob[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const totals = jobs.reduce(
    (acc, j) => {
      acc.cron += j.type === "cron" ? 1 : 0;
      acc.queue += j.type === "queue" ? 1 : 0;
      acc.ok += j.recent.ok;
      acc.error += j.recent.error;
      return acc;
    },
    { cron: 0, queue: 0, ok: 0, error: 0 },
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[16px] font-semibold tracking-tight text-[var(--color-fg)]">
            Ops
          </h1>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            {jobs.length} job{jobs.length === 1 ? "" : "s"}
            <Sep />
            <strong className="font-medium text-[var(--color-fg-soft)]">
              {totals.cron}
            </strong>{" "}
            cron
            <Sep />
            <strong className="font-medium text-[var(--color-fg-soft)]">
              {totals.queue}
            </strong>{" "}
            queue
            <Sep />
            <strong className="font-medium text-[var(--color-success)]">
              {totals.ok}
            </strong>{" "}
            recent ok
            <Sep />
            <strong
              className={`font-medium ${totals.error > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-fg-soft)]"}`}
            >
              {totals.error}
            </strong>{" "}
            recent err
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={async () => {
              if (
                !window.confirm(
                  "Delete all execution rows across every job? (Job definitions stay registered.)",
                )
              )
                return;
              try {
                const res = await client.playgroundReset();
                toast.success(`Reset — deleted ${res.deleted} row(s)`);
                load();
              } catch (e) {
                toast.error(
                  `Reset failed: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-fg-muted)] hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
          >
            <Trash2 size={12} strokeWidth={2.25} />
            Reset
          </button>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-fg-muted)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            <RefreshCw size={12} strokeWidth={2.25} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] px-2.5 py-1.5 text-[11px] text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="grid grid-cols-[1fr_70px_140px_100px_50px_50px_100px] items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-fg-muted)]">
          <div>Name</div>
          <div>Type</div>
          <div>Schedule</div>
          <div>Last run</div>
          <div className="text-right">OK</div>
          <div className="text-right">Err</div>
          <div />
        </div>
        {jobs.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-[var(--color-fg-dim)]">
            No jobs registered.
          </div>
        ) : (
          jobs.map((job) => (
            <JobRow
              key={job.name}
              job={job}
              onRunClick={() => setRunTarget(job)}
              onExecutionChanged={load}
            />
          ))
        )}
      </div>

      {runTarget && (
        <RunJobDialog
          job={runTarget}
          onClose={() => setRunTarget(null)}
          onSuccess={(kind: "cron" | "queue") => {
            setRunTarget(null);
            toast.success(
              kind === "cron"
                ? `Triggered ${runTarget.name}`
                : `Queued ${runTarget.name}`,
            );
            load();
          }}
        />
      )}
    </div>
  );
};

const Sep = () => <span className="mx-1.5 text-[var(--color-fg-dim)]">·</span>;

export default Ops;
