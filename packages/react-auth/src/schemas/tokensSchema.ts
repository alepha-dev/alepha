import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const tokensSchema = t.object({
	provider: t.string(),
	access_token: t.string({ size: "rich" }),
	issued_at: t.number(),
	expires_in: t.optional(t.number()),
	refresh_token: t.optional(t.string({ size: "rich" })),
	refresh_token_expires_in: t.optional(t.number()),
	id_token: t.optional(t.string({ size: "rich" })),
	scope: t.optional(t.string()),
});

export type Tokens = Static<typeof tokensSchema>;
