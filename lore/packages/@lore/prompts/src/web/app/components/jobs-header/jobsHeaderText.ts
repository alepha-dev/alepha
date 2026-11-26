// alepha-allow no-module-code: a plain formatting helper the header's jobs button, its rows and the side panel share, not a DI service: nothing to substitute

export { argsText as jobArgsText } from "../host-jobs/jobText.ts";

/**
 * An elapsed time as a clock: `04:12`, `1:02:09`.
 */
export const jobClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

// alepha-allow no-module-code: see above
/**
 * Each job status as the header's list and the side panel say it, by
 * literal key so the i18n audit sees every one.
 */
export const JOB_HEADER_STATUS = {
  queued: "jobs.header.status.queued",
  running: "jobs.header.status.running",
  succeeded: "jobs.header.status.succeeded",
  failed: "jobs.header.status.failed",
  timed_out: "jobs.header.status.timed_out",
  cancelled: "jobs.header.status.cancelled",
} as const;
