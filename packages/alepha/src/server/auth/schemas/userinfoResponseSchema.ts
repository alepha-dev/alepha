import { type Static, z } from "alepha";
import { userAccountInfoSchema } from "alepha/security";
import { apiRegistryResponseSchema } from "alepha/server/links";

export const userinfoResponseSchema = z.object({
  user: userAccountInfoSchema.optional(),
  api: apiRegistryResponseSchema,
});

export type UserinfoResponse = Static<typeof userinfoResponseSchema>;
