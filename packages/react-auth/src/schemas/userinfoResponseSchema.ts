import { type Static, t } from "@alepha/core";
import { userAccountInfoSchema } from "@alepha/security";
import { apiLinksResponseSchema } from "@alepha/server";

export const userinfoResponseSchema = t.object({
	user: t.optional(userAccountInfoSchema),
	links: apiLinksResponseSchema,
});

export type UserinfoResponse = Static<typeof userinfoResponseSchema>;
