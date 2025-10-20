import { type Static, t } from "@alepha/core";
import { userAccountInfoSchema } from "@alepha/security";
import { apiLinksResponseSchema } from "@alepha/server-links";

export const userinfoResponseSchema = t.object({
  user: t.optional(userAccountInfoSchema),
  api: apiLinksResponseSchema,
});

export type UserinfoResponse = Static<typeof userinfoResponseSchema>;
