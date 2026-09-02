import type { Infer } from "alepha";
import { z } from "alepha";

export const tokensSchema = z.object({
  provider: z.text(),
  realm: z
    .text()
    .describe(
      "Realm the tokens were minted in. Each realm registers its own provider under the same name, so a refresh without it lands on the first realm's issuer.",
    )
    .optional(),
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

export type Tokens = Infer<typeof tokensSchema>;
