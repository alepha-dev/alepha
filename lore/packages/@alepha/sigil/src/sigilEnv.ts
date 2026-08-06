import { z } from "alepha";

/**
 * The commons an app reports to when it names no other.
 *
 * Exported rather than written twice, because {@link SigilSinkProvider} has to
 * be able to tell "resolved from the default" from "resolved from env" in order
 * to say so at boot, and a second literal is how those two answers start
 * disagreeing.
 */
export const SIGIL_DEFAULT_SINK = "https://lore.alepha.dev";

/**
 * Sigil configuration, read from the app's server env.
 *
 * **`SIGIL_KEY` is the only variable that matters.** Nothing is ever sent
 * without it — `SigilSinkProvider.hasSink()` gates every flush on it — so an
 * app that sets none of these still captures locally and hands aggregated
 * errors to its own logger, phoning home to nothing. That is the headless case,
 * and it stays the default.
 *
 * `SIGIL_SINK` defaults to the public Lore instance, in the same way `npm`
 * defaults to `registry.npmjs.org` and `go` to `proxy.golang.org`: a commons
 * that is there if you want it and one variable away if you do not. The default
 * is safe to carry precisely because it does nothing on its own — a key is
 * still minted deliberately, by whichever instance you chose, and a key from a
 * self-hosted Lore simply 401s against the public one rather than leaking into
 * it. {@link SigilSinkProvider} logs which origin it resolved and where that
 * came from, so a default is never a surprise.
 *
 * `SIGIL_SALT` is an override, not a requirement. The visitor salt falls back
 * to `APP_SECRET`, which Alepha already refuses to leave at its built-in
 * default in production — so the hash is unguessable with no configuration at
 * all. Set this only to decouple the two: rotating `APP_SECRET` otherwise
 * restarts the day's unique count, which is academic given that rotation also
 * invalidates every session.
 *
 * Everything about *how much* to collect comes from the sink at runtime
 * (`GET {SIGIL_SINK}/sigils/config`), never from env: a kill-switch that needs
 * a redeploy is a kill-switch nobody reaches in time.
 */
export const sigilEnv = z.object({
  SIGIL_SINK: z.text({
    default: SIGIL_DEFAULT_SINK,
    description:
      "Origin of the sigil sink. Defaults to the public Lore instance; override to self-host. Inert without SIGIL_KEY.",
  }),
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
