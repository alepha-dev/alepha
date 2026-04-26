import { useClient } from "alepha/react";
import { Loader2, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlaygroundController } from "../../api/PlaygroundController.ts";
import type { JobRowJob } from "./JobRow.tsx";

interface RunJobDialogProps {
  job: JobRowJob;
  onClose: () => void;
  onSuccess: (kind: "cron" | "queue") => void;
}

const PRIORITIES = ["critical", "high", "normal", "low"] as const;

export const RunJobDialog = (props: RunJobDialogProps) => {
  const client = useClient<PlaygroundController>();
  const isQueue = props.job.type === "queue";

  const [payload, setPayload] = useState("");
  const [loadingSample, setLoadingSample] = useState(isQueue);
  const [delaySeconds, setDelaySeconds] = useState<string>("");
  const [key, setKey] = useState<string>("");
  const [priority, setPriority] = useState<
    "critical" | "high" | "normal" | "low"
  >(props.job.priority);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a schema-derived sample for queue jobs
  useEffect(() => {
    if (!isQueue) return;
    let aborted = false;
    (async () => {
      try {
        const res = await client.playgroundJobSample({
          params: { name: props.job.name },
        });
        if (aborted) return;
        setPayload(
          res.sample
            ? JSON.stringify(res.sample, null, 2)
            : '{\n  "example": "value"\n}',
        );
      } catch {
        if (aborted) return;
        setPayload('{\n  "example": "value"\n}');
      } finally {
        if (!aborted) setLoadingSample(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [client, isQueue, props.job.name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      let parsedPayload: Record<string, unknown> | undefined;
      if (isQueue) {
        try {
          parsedPayload = JSON.parse(payload);
        } catch (e) {
          throw new Error(
            `Invalid JSON payload: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      const delay = delaySeconds.trim()
        ? Number(delaySeconds.trim())
        : undefined;
      if (delay !== undefined && (!Number.isFinite(delay) || delay < 1)) {
        throw new Error("Delay must be a positive integer (seconds).");
      }

      await client.runAnyJob({
        body: {
          name: props.job.name,
          payload: parsedPayload,
          delaySeconds: delay,
          key: key.trim() || undefined,
          priority,
        },
      });
      props.onSuccess(isQueue ? "queue" : "cron");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={props.onClose}
    >
      <div
        className="flex w-[520px] max-w-[90vw] flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-4 py-2.5">
          <div className="flex flex-col gap-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-fg-muted)]">
              Run {props.job.type === "cron" ? "cron" : "queue"} job
            </span>
            <span className="font-mono text-[12px] text-[var(--color-fg)]">
              {props.job.name}
            </span>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-4 py-3">
          {!isQueue && (
            <div className="rounded border border-[var(--color-info)]/30 bg-[var(--color-info-soft)] px-2.5 py-1.5 text-[11px] text-[var(--color-info)]">
              Cron jobs run inline — no payload, delay, key, or priority.
            </div>
          )}

          {isQueue && (
            <Field
              label="Payload (JSON)"
              hint="Prefilled from the job's schema. Validated server-side."
            >
              <textarea
                value={loadingSample ? "// loading schema sample…" : payload}
                onChange={(e) => setPayload(e.target.value)}
                disabled={loadingSample}
                rows={7}
                spellCheck={false}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[11.5px] leading-snug text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] disabled:text-[var(--color-fg-dim)]"
              />
            </Field>
          )}

          {isQueue && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field
                label="Delay (seconds, optional)"
                hint="Status will be 'scheduled' until due."
              >
                <input
                  type="number"
                  min={1}
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(e.target.value)}
                  placeholder="(immediate)"
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                />
              </Field>
              <Field
                label="Key (optional, dedup)"
                hint="Re-pushes while in flight are idempotent."
              >
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="(none)"
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                />
              </Field>
            </div>
          )}

          {isQueue && (
            <Field
              label="Priority"
              hint={`Default from the job: ${props.job.priority}.`}
            >
              <div className="flex gap-1">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={[
                      "rounded border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      priority === p
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
                    ].join(" ")}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {error && (
            <div className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] px-2.5 py-1.5 text-[11px] text-[var(--color-danger)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/60 px-4 py-2.5">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loadingSample}
            className="flex items-center gap-1.5 rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1 text-[12px] font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2
                  size={12}
                  strokeWidth={2.25}
                  className="animate-spin"
                />
                Running…
              </>
            ) : (
              <>
                <Play size={11} strokeWidth={2.5} className="fill-current" />
                Run
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

const Field = (props: FieldProps) => (
  <div className="flex flex-col gap-1">
    <label className="flex flex-col gap-0">
      <span className="text-[11px] font-semibold text-[var(--color-fg)]">
        {props.label}
      </span>
      {props.hint && (
        <span className="text-[10px] text-[var(--color-fg-muted)]">
          {props.hint}
        </span>
      )}
    </label>
    {props.children}
  </div>
);
