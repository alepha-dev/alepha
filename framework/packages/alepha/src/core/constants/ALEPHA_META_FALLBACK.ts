import type { AlephaMeta } from "../interfaces/AlephaMeta.ts";

/**
 * What {@link Alepha.meta} reads when no build produced this code.
 *
 * The build replaces a token with the real record; anything that never went
 * through `alepha build` or `alepha dev` lands here instead - vitest, a `tsx`
 * script, `alepha` imported by a library consumer outside Vite.
 *
 * Deliberately not padded out with `"unknown"` in every slot. `date` and
 * `commit` are absent because their absence is the information: nothing built
 * this, and there was no git to ask. `dev: true` for the same reason - this is
 * as far from a production artifact as a record gets.
 */
export const ALEPHA_META_FALLBACK: AlephaMeta = {
  name: "unknown",
  version: "latest",
  framework: "unknown",
  build: {
    runtime: "node",
    dev: true,
  },
};
