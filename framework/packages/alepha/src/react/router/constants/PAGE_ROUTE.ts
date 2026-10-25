import type { PageRoute } from "../providers/ReactPageProvider.ts";

/**
 * Symbol stamped on every `ServerRoute` created from a `$page`, carrying the
 * page it was built from.
 *
 * The router registers pages by spreading the `PageRoute` into `createRoute`,
 * so the page's own fields (`component`, `lazy`, `errorHandler`, …) do survive
 * onto the server route — but sniffing them is guesswork, and `alepha/server`
 * cannot type a field it must not know about. An explicit symbol says what is
 * true without either compromise.
 */
export const PAGE_ROUTE = Symbol.for("alepha.react.router.page");

/**
 * A `ServerRoute` that was registered from a `$page`.
 */
export interface PageServerRoute {
  [PAGE_ROUTE]?: PageRoute;
}
