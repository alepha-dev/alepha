import { validationErrorDataSchema } from "../schemas/validationErrorDataSchema.ts";
import { HttpError } from "./HttpError.ts";

/**
 * The request does not match its schema, or a handler refuses some of its
 * fields: a 400 naming the `part` of the request (`body`, `query`, `params`,
 * `headers`) and its failing fields in `issues`. `details` keeps the first
 * path, for readers that predate `issues`.
 *
 * The router throws it when request validation fails. A handler throws the
 * same error to refuse a field, and the client sees no difference:
 *
 * ```ts
 * throw new ValidationError({
 *   part: "body",
 *   issues: [{ path: "/email", message: "Email already in use" }],
 * });
 * ```
 */
export const ValidationError = HttpError.extend({
  name: "VALIDATION_FAILED",
  schema: validationErrorDataSchema,
  default: { status: 400 },
  message: "Validation has failed",
});

export type ValidationError = InstanceType<typeof ValidationError>;
