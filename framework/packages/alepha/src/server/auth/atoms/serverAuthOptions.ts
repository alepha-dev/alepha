import { $atom, z } from "alepha";

/**
 * Options of `alepha/server/auth` for the whole app.
 *
 * ```ts
 * alepha.store.set(serverAuthOptions, { sessionStore: true });
 * ```
 */
export const serverAuthOptions = $atom({
  name: "alepha.server.auth.options",
  schema: z.object({
    sessionStore: z
      .boolean()
      .describe(
        "Keep the session's tokens in a server-side store, with only an opaque id in the cookie",
      )
      .default(false),
  }),
  default: {
    sessionStore: false,
  },
});
