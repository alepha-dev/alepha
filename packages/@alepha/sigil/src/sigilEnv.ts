import { z } from "alepha";

/**
 * Sigil configuration, read from the app's server env.
 *
 * Both fields are optional so `parseEnv` never throws, and their absence is a
 * supported mode rather than a misconfiguration: without a sink the module
 * still captures, and aggregated errors go to the logger instead. That is the
 * headless case — an app that must not phone home to anything.
 *
 * Everything else about how much to collect comes from the sink at runtime
 * (`GET {SIGIL_SINK}/sigils/config`), never from env: a kill-switch
 * that needs a redeploy is a kill-switch nobody reaches in time.
 */
export const sigilEnv = z.object({
  SIGIL_SINK: z
    .text({
      description:
        "Origin of the sigil sink, e.g. https://lore.example.com. Absent = capture locally, send nothing.",
    })
    .optional(),
  SIGIL_KEY: z
    .text({
      description:
        "Per-app enrolment key issued by the sink — secret, server-only. Absent = capture locally, send nothing.",
    })
    .optional(),
});
