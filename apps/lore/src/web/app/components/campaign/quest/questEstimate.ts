/**
 * One workday in minutes. The optional quest estimate (`quests.estimateMinutes`)
 * is stored as raw minutes; this is the unit a "day" rolls up to — large enough
 * to be meaningful for a rough estimate, and the value behind the `1d` preset
 * chip. Multi-day custom values roll up against this (e.g. 600 → `1d2h`).
 */
const WORKDAY_MINUTES = 480;

/**
 * Preset durations (in minutes) offered as one-tap chips on the quest form.
 * Kept low-friction and coarse on purpose — the estimate is a glanceable
 * "how long might this take" hint, not a precise plan. The `custom…` chip
 * covers anything off this ladder. Labels are derived via {@link formatEstimate}
 * so the chips and the questlog badge always read the same way.
 */
export const ESTIMATE_PRESETS: readonly number[] = [
  5,
  15,
  30,
  60,
  120,
  240,
  WORKDAY_MINUTES,
];

/**
 * Render a minute count as a compact, glanceable duration string — no leading
 * tilde (callers add `~` where they want to signal it's an estimate).
 *
 * Rules:
 * - `< 60` → `5m`, `25m`
 * - whole hours → `1h`, `4h`
 * - hours + minutes → `1h30` (minutes zero-padded, no unit, read as "h mm")
 * - one workday (480) and multiples → `1d`, `2d`
 * - day remainders roll up → `1d2h`, `1d45m`, `1d1h10`
 *
 * Returns `""` for zero / negative / falsy input so callers can render the
 * badge conditionally on a non-empty string.
 */
export const formatEstimate = (minutes: number): string => {
  if (!minutes || minutes <= 0) return "";

  const days = Math.floor(minutes / WORKDAY_MINUTES);
  const remainder = minutes % WORKDAY_MINUTES;
  const hours = Math.floor(remainder / 60);
  const mins = remainder % 60;

  let out = "";
  if (days > 0) out += `${days}d`;
  if (hours > 0) out += `${hours}h`;
  if (mins > 0) {
    // After an `h`, minutes are a zero-padded suffix (`1h30`). Otherwise
    // they carry their own unit (`45m`, or `1d45m` when only days precede).
    out += hours > 0 ? String(mins).padStart(2, "0") : `${mins}m`;
  }
  return out;
};
