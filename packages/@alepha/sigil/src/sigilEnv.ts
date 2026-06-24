import { z } from "alepha";

/**
 * Sigil module configuration, read from the partner app's server env.
 * Both fields are optional so `parseEnv` never throws; activation is gated
 * by `SIGIL_ID` presence + `isProduction()` in the server services.
 */
export const sigilEnv = z.object({
  SIGIL_ID: z
    .text({ description: "Lore sigil UUID — secret, server-only." })
    .optional(),
  LORE_URL: z
    .text({
      description: "Override Lore origin. Default https://lore.alepha.dev",
    })
    .optional(),
  SIGIL_FEATURES: z
    .text({
      description:
        "Comma-separated enabled features (petition,blights,beacon,vitals). Absent = all enabled; acts purely as a filter.",
    })
    .optional(),
});
