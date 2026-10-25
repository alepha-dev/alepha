import { $error } from "../primitives/$error.ts";
import { z } from "../providers/ZodProvider.ts";

/**
 * A substitution for a service that has already been built.
 */
export const TooLateSubstitutionError = $error({
  name: "TOO_LATE_SUBSTITUTION",
  schema: z.object({ original: z.text(), substitution: z.text() }),
  message: (data) =>
    `Service already substituted. Please, substitute Service '${data.original}' with Service '${data.substitution}' before using it.`,
});

export type TooLateSubstitutionError = InstanceType<
  typeof TooLateSubstitutionError
>;
