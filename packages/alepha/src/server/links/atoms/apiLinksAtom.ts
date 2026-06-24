import { $atom } from "alepha";
import { apiRegistryResponseSchema } from "../schemas/apiLinksResponseSchema.ts";

export const apiLinksAtom = $atom({
  name: "alepha.server.request.apiLinks",
  schema: apiRegistryResponseSchema.optional(),
});
