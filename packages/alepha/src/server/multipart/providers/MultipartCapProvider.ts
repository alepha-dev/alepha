import type { ServerRequest, ServerRoute } from "alepha/server";

/**
 * What a resolver may say about one request's size budget.
 *
 * Every field is optional: a resolver that only knows how big a single file may
 * be says exactly that, and the rest falls through to the next level.
 */
export interface MultipartCap {
  /** Largest a single part's content may be, in bytes. */
  maxFileSize?: number;
  /** Largest the whole message may be, in bytes. */
  maxTotalSize?: number;
  /** Most parts one message may carry. */
  maxParts?: number;
  /** Largest a single part's headers may be, in bytes. */
  maxHeaderSize?: number;
}

/**
 * Decides how many bytes a given request is allowed to carry.
 *
 * **The default has no opinion**, and that is deliberate: a framework-wide
 * ceiling that anything could raise would be a ceiling in name only. Apps
 * substitute this provider to answer for the routes they own — `alepha/api/files`
 * does exactly that, mapping the targeted `$storage` bucket to its `maxSize`.
 *
 * ```ts
 * alepha.with({ provide: MultipartCapProvider, use: MyCapProvider });
 * ```
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
  /**
   * Answers for this request, or `undefined` to defer.
   *
   * Called before a single byte of the body is read, which is what makes it
   * useful: the URL, the route and the headers are all known by then, so the
   * budget can be decided by where the bytes are going rather than discovered
   * after they arrive.
   */
  public resolve(
    _request: ServerRequest,
    _route: ServerRoute,
  ): MultipartCap | undefined {
    return undefined;
  }
}
