import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A statement binding more parameters than the driver accepts.
 */
export const DbTooManyParametersError = DbError.extend({
  name: "DB_TOO_MANY_PARAMETERS",
  default: { status: 400, retryable: false },
  schema: z.object({ retryable: z.boolean() }),
  message:
    "Statement binds more parameters than the driver accepts. Split the " +
    "list (an `inArray` binds one parameter per value) into chunks.",
});

export type DbTooManyParametersError = InstanceType<
  typeof DbTooManyParametersError
>;
