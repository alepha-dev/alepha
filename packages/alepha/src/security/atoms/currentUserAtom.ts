import { $atom } from "alepha";
import { userAccountInfoSchema } from "../schemas/userAccountInfoSchema.ts";

/**
 * Atom storing the current authenticated user.
 *
 * Transport-agnostic — works with HTTP, MCP, pipelines, jobs, and any context
 * that sets the atom before calling secured logic.
 */
export const currentUserAtom = $atom({
  name: "alepha.security.user",
  schema: userAccountInfoSchema.optional(),
});
