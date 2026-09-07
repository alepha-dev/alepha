import { $atom, z } from "alepha";

/**
 * The rank the caller holds in the scope this request is acting on, published
 * once it has been resolved.
 *
 * Follows `currentAuthorityAtom`, and exists for the same reason: the row the
 * gate decided against lives in a request memo under a key the gate composes
 * by hand, and every later reader that wants it has to reconstruct that
 * string. A resolved rank is worse, because it is a computation over two
 * reads rather than one row.
 *
 * So the gate publishes it here, and the imperative check and any handler
 * that wants to answer "what may this caller do" read it instead of resolving
 * again. Absent means the gate did not run - a `$secure` guard on a file
 * route, a resolver keyed on a slug - and the imperative path then resolves
 * from the rows it can reach.
 */
export const currentRankAtom = $atom({
  name: "alepha.ranks.current",
  schema: z
    .object({
      type: z.text(),
      scopeId: z.text(),
      /**
       * The rank key held, absent when the caller holds none in this scope.
       */
      key: z.text().optional(),
      name: z.text().optional(),
      /**
       * The effective permission set, floor included and `*` expanded to
       * itself: the set a UI may render from and an imperative check may ask.
       */
      permissions: z.array(z.text()),
    })
    .optional(),
  serverOnly: true,
});
