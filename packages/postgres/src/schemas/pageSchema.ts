/**
 * Re-export pagination types and schemas from @alepha/core.
 *
 * These are now framework-level primitives available to all packages.
 *
 * @see {@link $repository#paginate}
 */
export type { Page, TPage } from "@alepha/core";
export { pageSchema } from "@alepha/core";
