import { t } from "alepha";

/**
 * Sigil module configuration, read from the partner app's server env.
 * Both fields are optional so `parseEnv` never throws; activation is gated
 * by `SIGIL_ID` presence + `isProduction()` in the server services.
 */
export const sigilEnv = t.object({
  SIGIL_ID: t.optional(
    t.text({ description: "Lore sigil UUID — secret, server-only." }),
  ),
  LORE_URL: t.optional(
    t.text({
      description: "Override Lore origin. Default https://lore.alepha.dev",
    }),
  ),
  SIGIL_FEATURES: t.optional(
    t.text({
      description:
        "Comma-separated enabled features (petition,blights,beacon,vitals). Absent = all enabled; acts purely as a filter.",
    }),
  ),
});
