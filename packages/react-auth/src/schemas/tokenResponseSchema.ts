import { type Static, t } from "@alepha/core";
import { userAccountInfoSchema } from "@alepha/security";
import { apiLinksResponseSchema } from "@alepha/server";
import { tokensSchema } from "./tokensSchema.ts";

export const tokenResponseSchema = t.composite([
	tokensSchema,
	t.object({
		user: userAccountInfoSchema,
		links: apiLinksResponseSchema,
	}),
]);

export type TokenResponse = Static<typeof tokenResponseSchema>;
