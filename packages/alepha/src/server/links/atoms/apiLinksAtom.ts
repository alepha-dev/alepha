import { $atom } from "alepha";

import { apiRegistryResponseSchema } from "../schemas/apiLinksResponseSchema.ts";

export const apiLinksAtom = $atom({
  name: "alepha.server.request.apiLinks",
  schema: apiRegistryResponseSchema.optional(),
  // The actions this visitor may call: personal, so it travels in
  // `__ssr_private` and a cached page never carries another visitor's (#E78).
  personal: true,
});
