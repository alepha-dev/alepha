/**
 * The capabilities a sigil embed can run inside the partner app. Mirrors Lore's
 * server-side `SIGIL_KINDS` vocabulary so the env var, the atoms, and Lore's
 * authorization gate all speak the same words.
 *
 * - `petition` — the floating feedback button that opens the Lore petition popup.
 * - `blights`  — forward client + server errors to Lore.
 * - `beacon`   — pageview analytics pings.
 * - `vitals`   — web-vitals performance samples.
 */
export const SIGIL_FEATURES = [
  "petition",
  "blights",
  "beacon",
  "vitals",
] as const;

export type SigilFeature = (typeof SIGIL_FEATURES)[number];

/**
 * Parse a `SIGIL_FEATURES` env string (e.g. `"blights,petition"`) into the
 * validated feature list. Unknown tokens are dropped; a blank/absent string
 * yields `[]`. Callers treat `undefined` (env not set) differently from `[]`
 * (set but empty) — see `SigilForwardProvider.features`.
 */
export const parseSigilFeatures = (raw: string | undefined): SigilFeature[] => {
  if (!raw) {
    return [];
  }
  const requested = new Set(
    raw
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
  return SIGIL_FEATURES.filter((feature) => requested.has(feature));
};
