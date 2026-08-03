import type { ServerRequest, ServerRoute } from "alepha/server";

/**
 * What a resolver may say about one request's size budget.
 *
 * Every field is optional: a resolver that only knows how big a single file may
 * be says exactly that, and the rest falls through to the next level.
 */
export interface MultipartCap {
  /** Largest a single part's content may be, in bytes. */
  maxFileBytes?: number;
  /** Largest the whole message may be, in bytes. */
  maxTotalBytes?: number;
  /** Most parts one message may carry. */
  maxParts?: number;
  /** Largest a single part's headers may be, in bytes. */
  maxHeaderBytes?: number;
}

/**
 * Answers for the requests it recognises, or defers.
 *
 * Called before a single byte of the body is read — the URL, the route and the
 * headers are all known by then — which is what makes a per-destination budget
 * possible at all.
 */
export type MultipartCapResolver = (
  request: ServerRequest,
  route: ServerRoute,
) => MultipartCap | undefined;

/**
 * Decides how many bytes a given request is allowed to carry.
 *
 * **It has no opinion of its own**, and that is deliberate: a framework-wide
 * ceiling that anything could raise would be a ceiling in name only. Modules
 * add a resolver for the routes they own — `alepha/api/files` does exactly
 * that, mapping the targeted `$storage` bucket to its `maxSize`.
 *
 * ```ts
 * alepha.inject(MultipartCapProvider).use((request, route) => …);
 * ```
 *
 * A registry rather than a substitutable provider, because substitution has an
 * ordering constraint this cannot satisfy: whoever wants to answer usually
 * loads *after* the server that reads the answer, and by then the provider is
 * already resolved. Adding to a list works whenever it happens.
 *
 * ⚠️ **This is a security surface, not a convenience.** A resolver can raise a
 * limit, so whatever it keys on is chosen by the caller: a query parameter is
 * attacker-controlled, and a resolver that answers for *every* route lets any
 * request claim the largest budget the app declares anywhere. Answer
 * `undefined` for routes you do not own.
 *
 * ⚠️ And a raised limit is only safe on a path that streams. `$secure` runs
 * after the body hook, so on a buffering path the budget is reachable before
 * authentication — a bigger number there is a cheaper denial of service, not a
 * feature.
 */
export class MultipartCapProvider {
  protected readonly resolvers: MultipartCapResolver[] = [];

  /**
   * Adds a resolver. The last one added answers first.
   *
   * Last-wins rather than first-wins so an application can overrule a module it
   * imports without having to load before it — the ordering trap this registry
   * exists to avoid.
   */
  public use(resolver: MultipartCapResolver): void {
    this.resolvers.push(resolver);
  }

  /**
   * The first answer anyone offers, or `undefined` when nobody claims it.
   */
  public resolve(
    request: ServerRequest,
    route: ServerRoute,
  ): MultipartCap | undefined {
    for (let i = this.resolvers.length - 1; i >= 0; i--) {
      const cap = this.resolvers[i](request, route);
      if (cap) {
        return cap;
      }
    }
    return undefined;
  }
}
