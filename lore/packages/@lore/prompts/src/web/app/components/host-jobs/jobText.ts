import type { PromptJobArg } from "@lore/core/schemas";

/**
 * A job's args as a person says them: `#Q12 Fix the cart`, a member by name.
 */
export const argsText = (job: { args?: PromptJobArg[] }): string =>
  (job.args ?? [])
    .map(
      (it) =>
        [it.reference, it.title].filter(Boolean).join(" ") ||
        (it.type === "member" ? "" : it.value),
    )
    .filter(Boolean)
    .join(", ");

/**
 * `1 min 12 s`, `45 s`, `2 h 3 min`: the job events' own reading.
 */
export const durationText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ${s % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
