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
 *
 * Record keys are `z.string()`, not `z.text()`: a key is the serialized query
 * key, never user-facing text, and `z.text()` caps at 255 characters, which a
 * key holding a long path or a few ids passes easily.
 */
export const queryCacheAtom = $atom({
  name: "alepha.react.queryCache",
  schema: z.record(
    z.string(),
    z.object({
      data: z.any(),
      updatedAt: z.number(),
    }),
  ),
  default: {},
});
