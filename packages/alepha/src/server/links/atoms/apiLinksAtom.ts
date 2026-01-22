import { $atom, t } from "alepha";
import { apiLinksResponseSchema } from "../schemas/apiLinksResponseSchema.ts";

export const apiLinksAtom = $atom({
  name: "alepha.server.request.apiLinks",
  schema: t.optional(apiLinksResponseSchema),
});
