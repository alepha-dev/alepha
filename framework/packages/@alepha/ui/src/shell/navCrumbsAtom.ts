import { $atom, z } from "alepha";

/**
 * The crumbs a detail page puts in place of its own.
 *
 * The trail is the route chain, so a detail page mounted under the shell
 * layout reads `Shell > Detail`, with no list in between and the route's
 * static label as the leaf. A page that knows better (the list it belongs
 * to, the name of what it shows) sets this through `useNavCrumbs`; the trail
 * swaps the crumb of the route named `route` for `crumbs`, and only while
 * that route is the open leaf, so a value a page forgot to clear can never
 * relabel another one.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const navCrumbsAtom = $atom({
  name: "ui.nav.crumbs",
  schema: z.object({
    route: z.string(),
    crumbs: z.array(
      z.object({
        label: z.string(),
        href: z.string().optional(),
      }),
    ),
  }),
  default: { route: "", crumbs: [] },
});
