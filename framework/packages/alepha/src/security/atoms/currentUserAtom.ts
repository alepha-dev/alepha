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
  // Who the page is for, never what it shows: written to `__ssr_private`,
  // and a render that reads it is personal (#E78).
  personal: true,
  // The server keeps the full user; the browser gets what an interface may
  // show. `token` is not in the schema at all, so validation already dropped
  // it. `realm` stays (#Q3105): the browser `$secure({ issuers })` reads it,
  // and without it refused every client navigation to an issuer-guarded page.
  // A realm's name is no secret: every door sends it as `realm=`.
  serialize: (user) => {
    if (!user) {
      return user;
    }
    const { credential, ownership, permissionScope, ...client } = user;
    return client;
  },
});
