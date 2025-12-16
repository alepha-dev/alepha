import type { Static } from "alepha";
import { t } from "alepha";

export const tokensSchema = t.object({
  provider: t.text(),
  access_token: t.text({ size: "rich" }),
  issued_at: t.number(),
  expires_in: t.optional(t.number()),
  refresh_token: t.optional(t.text({ size: "rich" })),
  refresh_token_expires_in: t.optional(t.number()),
  refresh_expires_in: t.optional(
    t.number({
      description:
        "Alias of `refresh_token_expires_in` for compatibility with some providers.",
    }),
  ),
  id_token: t.optional(t.text({ size: "rich" })),
  scope: t.optional(t.text()),
});

export type Tokens = Static<typeof tokensSchema>;
