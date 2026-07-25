import { $atom, z } from "alepha";

/**
 * Backing store for `useQuery`'s keyed cache.
 *
 * One registered atom holding a key→entry record, rather than one store key
 * per query. That shape is forced by `StateManager.exportAtoms()`, which
 * serializes **registered atoms only** — going through an atom is what makes
 * server-rendered query results hydrate on the client with no extra plumbing.
 *
 * Per-key subscription scoping is recovered by reading through `useSelector`,
 * so a write to one key does not re-render subscribers of another.
 */
export const queryCacheAtom = $atom({
  name: "alepha.react.queryCache",
  schema: z.record(
    z.text(),
    z.object({
      data: z.any(),
      updatedAt: z.number(),
    }),
  ),
  default: {},
});
