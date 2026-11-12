import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A `DATABASE_URL` whose scheme no driver accepts.
 *
 * The message names the scheme and the accepted ones, never the rest of the
 * URL: it may carry a password.
 */
export const DbUrlError = DbError.extend({
  name: "DB_URL_UNSUPPORTED",
  schema: z.object({ scheme: z.text(), accepted: z.text() }),
  message: (data) =>
    `DATABASE_URL scheme '${data.scheme}:' is not supported. Accepted: ${data.accepted}.`,
});

export type DbUrlError = InstanceType<typeof DbUrlError>;
