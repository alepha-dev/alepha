import { z } from "alepha";

/**
 * A `realm` key, refused wherever the users API would otherwise drop it.
 *
 * The users API names its realm `userRealmName`, a query parameter. The two
 * natural misspellings used to be accepted and ignored: a `realm` field in a
 * create body was stripped with the rest of the undeclared keys, so the
 * account landed in the default realm, and a `realm=` query was never read,
 * so a listing answered with the caller's realm. Both look like success. A
 * downstream production (Mikanda) acquired two accounts in a realm whose door
 * does not open its back office that way.
 *
 * Declared rather than left undeclared, so the key is refused with a message
 * naming the parameter, and a typed client cannot pass it at all. Optional,
 * so leaving it out changes nothing.
 */
export const refusedRealmSchema = z
  .undefined({
    error:
      "The realm is named by the userRealmName query parameter; a `realm` key is refused here rather than ignored.",
  })
  .optional();
