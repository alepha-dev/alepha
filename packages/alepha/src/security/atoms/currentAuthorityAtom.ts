import { $atom, z } from "alepha";

/**
 * The row `$owns` made its access decision against, for the current request.
 *
 * Usually the same row as {@link currentResourceAtom}. They diverge when
 * `through` is set: the resource is the row the route param names (a quest),
 * the authority is the row that actually holds the ownership and membership
 * columns (its project).
 *
 * Published even without `through`, holding the same row as the resource, so a
 * handler reading "the row I was gated against" writes the same line whether
 * its endpoint hops or not.
 *
 * `serverOnly` for the same reason as `currentResourceAtom`: it is a raw
 * database record and must never reach the SSR hydration payload.
 */
export const currentAuthorityAtom = $atom({
  name: "alepha.security.currentAuthority",
  schema: z.record(z.text(), z.any()).optional(),
  serverOnly: true,
});
