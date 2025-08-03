import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const tokensSchema = t.object({
	provider: t.optional(t.string()),
	access_token: t.optional(t.string({ size: "rich" })),
	expires_in: t.optional(t.number()),
	refresh_token: t.optional(t.string({ size: "rich" })),
	id_token: t.optional(t.string({ size: "rich" })),
	scope: t.optional(t.string()),
	issued_at: t.optional(t.number()),
});

export type Tokens = Static<typeof tokensSchema>;
