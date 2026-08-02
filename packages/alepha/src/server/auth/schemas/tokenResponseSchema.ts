import type { Infer } from "alepha";
import { userAccountInfoSchema } from "alepha/security";
import { apiRegistryResponseSchema } from "alepha/server/links";
import { tokensSchema } from "./tokensSchema.ts";

export const tokenResponseSchema = tokensSchema.extend({
  user: userAccountInfoSchema,
  api: apiRegistryResponseSchema,
});

export type TokenResponse = Infer<typeof tokenResponseSchema>;
