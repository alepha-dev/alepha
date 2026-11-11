import { z } from "alepha";

/**
 * What the session cookie holds when the server-side session store is on:
 * which provider signed the visitor in, and the opaque id of the entry that
 * holds the tokens.
 */
export const sessionReferenceSchema = z.object({
  provider: z.text(),
  realm: z.text().optional(),
  id: z.text(),
});
