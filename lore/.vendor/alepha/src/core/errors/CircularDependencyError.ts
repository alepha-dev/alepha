import { $error } from "../primitives/$error.ts";
import { z } from "../providers/ZodProvider.ts";

/**
 * A service that needs itself, through its parents, to be built.
 */
export const CircularDependencyError = $error({
  name: "CIRCULAR_DEPENDENCY",
  schema: z.object({
    provider: z.text(),
    parents: z.array(z.text()).optional(),
  }),
  message: (data) =>
    `Instance not available. Looks like a circular dependency. ? -> ${data.parents?.map((name) => `${name} -> `).join("") ?? ""}${data.provider} -> ?`,
});

export type CircularDependencyError = InstanceType<
  typeof CircularDependencyError
>;
