import { $atom, z } from "alepha";

/**
 * Whether the global search palette is open.
 *
 * An atom rather than component state because the openers and the palette
 * sit in different parts of the tree: the header's search button and the
 * ⌘K binding both open it, and the palette itself mounts in the app
 * layout. Following the house rule of `$atom` + `useStore` over React
 * context for exactly this shape of cross-tree state.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const spotlightOpenAtom = $atom({
  name: "lor.spotlight.open",
  schema: z.object({
    open: z.boolean(),
  }),
  default: { open: false },
});
