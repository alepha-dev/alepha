import type { Static } from "alepha";
import { z } from "alepha";

export const tokensSchema = z.object({
  provider: z.text(),
  access_token: z.text({ size: "rich" }),
  issued_at: z.number(),
  expires_in: z.number().optional(),
  refresh_token: z.text({ size: "rich" }).optional(),
  refresh_token_expires_in: z.number().optional(),
  refresh_expires_in: z
    .number()
    .describe(
      "Alias of `refresh_token_expires_in` for compatibility with some providers.",
    )
    .optional(),
  id_token: z.text({ size: "rich" }).optional(),
  scope: z.text().optional(),
});

export type Tokens = Static<typeof tokensSchema>;
