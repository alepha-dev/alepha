import { z } from "alepha";
import {
  SIGIL_DEFAULT_SINK,
  sigilConfig,
} from "./shared/schemas/sigilConfig.ts";

export { SIGIL_DEFAULT_SINK };

/**
 * Sigil configuration, read from the app's server env.
 *
 * **`SIGIL_KEY` is the only secret.** Nothing is ever sent without it —
 * `SigilSinkProvider.hasSink()` gates every flush on it — so an app that sets
 * none of these still captures locally and hands aggregated errors to its own
 * logger, phoning home to nothing. That is the headless case, and it stays the
 * default.
 *
 * `SIGIL_CONFIG` is one JSON object rather than a variable per switch. It is
 * the thing an operator edits, so it is worth it being one field in one place:
 * see {@link sigilConfig} for why it lives here rather than being fetched from
 * the sink. It replaced a `SIGIL_SINK` variable, which is now the `sink` field
 * — a self-hoster sets it once and nobody else ever names it.
 *
 * `SIGIL_SALT` is an override, not a requirement. The visitor salt falls back
 * to `APP_SECRET`, which Alepha already refuses to leave at its built-in
 * default in production — so the hash is unguessable with no configuration at
 * all. Set this only to decouple the two: rotating `APP_SECRET` otherwise
 * restarts the day's unique count, which is academic given that rotation also
 * invalidates every session.
 *
 * @example
 * ```
 * SIGIL_KEY=sg_…
 * SIGIL_CONFIG={"project":"alepha","vitals":false}
 * ```
 */
export const sigilEnv = z.object({
  /**
   * Optional so an app can install this module and configure it later — the
   * package is inert without `SIGIL_KEY` anyway. `SigilSinkProvider` warns at
   * boot when a key is present without a config and stays inert, rather than
   * reporting into a project nobody named.
   *
   * Declassified: every field of it is already public. The project slug and
   * the sink origin are in the feedback URL this package renders into the
   * page, and the switches describe what the app collects, which it announces
   * by collecting it. Nothing here authorizes anything — `SIGIL_KEY` does, and
   * that one is a secret. Being a plaintext binding is what makes it editable
   * in a deploy dashboard, which is the whole reason it is one variable and
   * not a fetch from the sink.
   */
  SIGIL_CONFIG: sigilConfig.meta({ secret: false }).optional(),
  SIGIL_KEY: z.text({
    default: "",
    description:
      "Per-app enrolment key issued by the sink — secret, server-only. Absent = capture locally, send nothing.",
  }),
  SIGIL_SALT: z.text({
    default: "",
    description:
      "Overrides the secret salting the daily visitor hash — server-only. Falls back to APP_SECRET when unset.",
  }),
});
