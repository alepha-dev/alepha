import { type Static, t } from "alepha";
import { userAccountInfoSchema } from "alepha/security";
import { apiRegistryResponseSchema } from "alepha/server/links";

export const userinfoResponseSchema = t.object({
  user: t.optional(userAccountInfoSchema),
  api: apiRegistryResponseSchema,
});

export type UserinfoResponse = Static<typeof userinfoResponseSchema>;
