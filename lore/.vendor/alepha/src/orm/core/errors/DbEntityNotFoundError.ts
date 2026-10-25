import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A lookup by id that found no row.
 */
export const DbEntityNotFoundError = DbError.extend({
  name: "DB_ENTITY_NOT_FOUND",
  default: { status: 404 },
  schema: z.object({ entity: z.text() }),
  message: (data) => `Entity from '${data.entity}' was not found`,
});

export type DbEntityNotFoundError = InstanceType<typeof DbEntityNotFoundError>;
