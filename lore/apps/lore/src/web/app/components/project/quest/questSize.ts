/**
 * The five t-shirt sizes, keyed by the ordinal stored in `quests.size`.
 *
 * The column holds the ordinal rather than the label so ordering stays in
 * SQL: `priority` is a text enum, which is exactly why the questlog has to
 * carry its own `PRIORITY_ORDER` map to sort it client-side. The label is
 * what every surface shows, because a bare `3` says nothing on its own.
 *
 * T-shirt sizes rather than the F/C/B/A/S rank letters erased on 2026-08-20:
 * they need no glossary, they sort the way anyone would guess, and they
 * describe the work instead of grading whoever picks it up.
 */
export const QUEST_SIZE_LABELS: Record<number, string> = {
  1: "XS",
  2: "S",
  3: "M",
  4: "L",
  5: "XL",
};

/**
 * The neutral middle: what pre-existing rows were backfilled with, what the
 * create form pre-selects, and what the server falls back to when a caller
 * omits the field.
 */
export const DEFAULT_QUEST_SIZE = 3;

/**
 * Options for the create form's segmented control.
 *
 * `value` is a string because that is what `ControlSelect` matches its
 * options on; it coerces back to a number on the way out, since the bound
 * schema is an integer. Built from {@link QUEST_SIZE_LABELS} so the control
 * and the badges can never drift apart.
 */
export const QUEST_SIZE_OPTIONS = Object.entries(QUEST_SIZE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/**
 * Label for a stored ordinal, or `""` for anything outside the 1-5 the
 * schema allows, so callers can render conditionally on a non-empty string
 * (the same contract `formatEstimate` offers).
 */
export const formatQuestSize = (size: number | null | undefined): string =>
  size == null ? "" : (QUEST_SIZE_LABELS[size] ?? "");
