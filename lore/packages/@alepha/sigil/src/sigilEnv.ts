import { z } from "alepha";
import { sigilConfig } from "./shared/schemas/sigilConfig.ts";

/** The commons an app reports to when it names no other. */
export const SIGIL_DEFAULT_SINK = "https://lore.alepha.dev";

/**
 * Sigil configuration, read from the app's server env.
 *
 * **`SIGIL_KEY` is the only variable an app needs, and the only secret.**
 * Nothing is ever sent without it, and nothing else is required alongside it:
 * the key names its own project, and the sink has a default. An app that sets
 * none of these still captures locally and hands aggregated errors to its own
 * logger, phoning home to nothing. That is the headless case, and it stays the
 * default.
 *
 * `SIGIL_SINK` is one flat name because it is set once, before anything works,
 * by someone standing up their own instance, and it is a URL rather than a
 * switch. It lived inside `SIGIL_CONFIG` for a while as a `sink` field, and the
 * rename reached the schema and nothing an operator reads: the sink's own
 * enrolment copy and this package's README both went on saying `SIGIL_SINK`
 * until the field came back.
 *
 * `SIGIL_CONFIG` is one JSON object rather than a variable per switch, and is
 * entirely optional. See {@link sigilConfig} for why the switches belong
 * together and why they are not fetched from the sink.
 *
 * `SIGIL_SALT` is an override, not a requirement. The visitor salt falls back
 * to `APP_SECRET`, which Alepha already refuses to leave at its built-in
 * default in production, so the hash is unguessable with no configuration at
 * all. Set this only to decouple the two: rotating `APP_SECRET` otherwise
 * restarts the day's unique count, which is academic given that rotation also
 * invalidates every session.
 *
 * @example
 * ```
 * SIGIL_KEY=sg_alepha_…
 * ```
 *
 * @example
 * ```
 * SIGIL_KEY=sg_my-app_…
 * SIGIL_SINK=https://lore.example.com
 * SIGIL_CONFIG={"vitals":false,"feedbackButton":"hidden"}
 * ```
 */
export const sigilEnv = z.object({
  /**
   * Optional, and inert on its own. Every field is a switch over what this app
   * collects, and each already has the answer an unconfigured app wants.
   *
   * Declassified: none of it is a secret. The switches describe what the app
   * collects, which it announces by collecting it. Nothing here authorizes
   * anything. Being a plaintext binding is what makes it editable in a deploy
   * dashboard, which is the whole reason it is one variable and not a fetch
   * from the sink.
   */
  SIGIL_CONFIG: sigilConfig.meta({ secret: false }).optional(),
  SIGIL_KEY: z.text({
    default: "",
    description:
      "Per-app enrolment key issued by the sink, shaped `sg_<project>_<secret>` - secret, server-only. Absent = capture locally, send nothing.",
  }),
  /**
   * Where to report.
   *
   * Defaults to the public instance the way `npm` defaults to
   * `registry.npmjs.org`: a commons that is there if you want it and one field
   * away if you do not. Safe to carry as a default precisely because it does
   * nothing alone. A key is still minted deliberately by whichever instance you
   * chose, and a key from a self-hosted sink simply 401s against the public one
   * rather than leaking into it.
   *
   * Not a secret, and declared plaintext so a deploy dashboard shows it. An
   * operator who cannot see which origin their app reports to cannot notice
   * that it is the wrong one.
   */
  SIGIL_SINK: z.text({
    default: SIGIL_DEFAULT_SINK,
    secret: false,
    description:
      "Origin of the sink this app reports to. Defaults to the public Lore instance.",
  }),
  SIGIL_SALT: z.text({
    default: "",
    description:
      "Overrides the secret salting the daily visitor hash - server-only. Falls back to APP_SECRET when unset.",
  }),
});
