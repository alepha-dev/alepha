import type { ProjectErrorResource } from "../../../../../api/schemas/projectErrorResourceSchema.ts";

/**
 * What the inbox's Status filter can pick. `seenAgain` is no status of its
 * own: a resolved error its app reported again (#Q4466).
 */
export type ProjectErrorStatusChoice = "open" | "resolved" | "seenAgain";

/**
 * Whether an error is one the Status filter asked for: any of the choices
 * picked, and every error when none is. A forwarded error matches no choice,
 * so it shows only with the filter cleared.
 */
export const matchesProjectErrorStatus = (
  error: Pick<ProjectErrorResource, "status" | "seenAgain">,
  choices: readonly ProjectErrorStatusChoice[],
): boolean => {
  if (choices.length === 0) return true;
  return choices.some((choice) =>
    choice === "seenAgain" ? Boolean(error.seenAgain) : error.status === choice,
  );
};
