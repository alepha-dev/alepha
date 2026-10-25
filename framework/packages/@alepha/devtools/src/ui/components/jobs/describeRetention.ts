import type { JobRetention } from "alepha/api/jobs";

type Rule = JobRetention["ok"];

const rule = (value: Rule, noun: string): string => {
  if (value === false) return `no ${noun}`;
  const parts: string[] = [];
  if (value.last !== undefined) parts.push(`last ${value.last}`);
  if (value.days !== undefined) parts.push(`${value.days}d`);
  return `${noun} ${parts.join(" / ")}`;
};

/**
 * One line for a job's effective retention, e.g. `ok last 7 · error 30d`.
 * `false` reads as `no ok`: the status is not recorded.
 */
export const describeRetention = (retention?: JobRetention): string => {
  if (!retention) return "unknown";
  return `${rule(retention.ok, "ok")} · ${rule(retention.error, "error")}`;
};

/**
 * Where the rule came from: the job's own declaration, the framework's
 * default, or both, with a cron's cadence bucket.
 */
export const describeRetentionSource = (retention?: JobRetention): string => {
  if (!retention) return "";
  const { ok, error } = retention.source;
  const origin =
    ok === error ? `${ok} rule` : `ok: ${ok} rule, error: ${error} rule`;
  return retention.cadence ? `${origin} · ${retention.cadence} cron` : origin;
};
