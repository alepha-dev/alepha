import { z } from "../providers/ZodProvider.ts";

/**
 * The environment Alepha itself reads, whatever modules the app loads.
 *
 * No service declares these keys, so `Alepha.dump()` parses this schema
 * itself, which is what puts them in every build's manifest. Each one is
 * `secret: false`: none is sensitive, and a deploy target (Lore's Environment
 * tab) may store and show it in plaintext (#Q2945).
 */
export const alephaEnvSchema = z.object({
  APP_NAME: z
    .text({
      secret: false,
      description:
        "The application's name: the log, storage and actor prefix. Defaults to the build's project name.",
    })
    .optional(),
});
