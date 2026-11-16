import { $atom } from "alepha";

import { useCaseResourceSchema } from "../../../api/schemas/useCaseResourceSchema.ts";

/**
 * The use case whose page is open (#E153), set by its route's loader: the
 * breadcrumb leaf lives in `ProjectView`, above the page, and reads it here.
 */
export const currentUseCaseAtom = $atom({
  name: "lor.current.useCase",
  schema: useCaseResourceSchema.optional(),
});
