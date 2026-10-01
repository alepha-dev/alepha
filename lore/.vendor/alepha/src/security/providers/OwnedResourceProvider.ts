import { $inject, Alepha, AlephaError } from "alepha";

import { currentAuthorityAtom } from "../atoms/currentAuthorityAtom.ts";
import { currentResourceAtom } from "../atoms/currentResourceAtom.ts";

/**
 * Reads the resource resolved by `$owns` for the current request.
 *
 * `$owns` already loads the row to make its access decision, so the handler
 * should not fetch it a second time. Inject this provider to read it back:
 *
 * ```typescript
 * class CampaignController {
 *   protected readonly owned = $inject(OwnedResourceProvider);
 *
 *   read = $action({
 *     path: "/campaigns/:id",
 *     use: [$secure(), $owns({ repository: () => this.campaigns, param: "id", owner: "createdBy" })],
 *     handler: async () => this.owned.get<Campaign>(),
 *   });
 * }
 * ```
 *
 * Two rows, not one, once a gate declares `through`:
 *
 * - `get()` is the row the route param named (a quest).
 * - `authority()` is the row the decision was made against (its project) -
 *   the same row as `get()` when there is no hop, so a handler reads it the
 *   same way whether its endpoint hops or not.
 *
 * `find()` / `findAuthority()` are the non-throwing forms, for a handler
 * legitimately reachable both with and without the gate.
 */
export class OwnedResourceProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * The resolved resource.
   *
   * Throws when the handler has no `$owns` in its `use` array — that is a
   * wiring mistake, not a runtime condition, so it fails loudly rather than
   * handing back `undefined` for the caller to trip over downstream.
   */
  public get<T>(): T {
    const row = this.find<T>();

    if (row === undefined) {
      throw new AlephaError(
        "OwnedResourceProvider.get() called without $owns() in the handler's `use` array.",
      );
    }

    return row;
  }

  /**
   * The resolved resource, or `undefined` when no `$owns` ran. Use this when a
   * handler is reachable both with and without the gate.
   */
  public find<T>(): T | undefined {
    return this.alepha.store.get(currentResourceAtom) as T | undefined;
  }

  /**
   * The row the access decision was made against.
   *
   * Identical to {@link get} unless the gate declared `through`, in which case
   * this is the row one hop away - the project a quest belongs to, say, which
   * is where `owner` and `via` were read. A handler that needs it (an
   * owner-only branch inside a member-gated endpoint, a feature toggle) reads
   * it here instead of issuing a second query for a row the gate already
   * loaded.
   *
   * Throws for the same reason {@link get} does: no `$owns` in the `use`
   * array is a wiring mistake, not a runtime condition.
   */
  public authority<T>(): T {
    const row = this.findAuthority<T>();

    if (row === undefined) {
      throw new AlephaError(
        "OwnedResourceProvider.authority() called without $owns() in the handler's `use` array.",
      );
    }

    return row;
  }

  /**
   * The authority row, or `undefined` when no `$owns` ran. The counterpart of
   * {@link find}, for handlers reachable both with and without the gate.
   */
  public findAuthority<T>(): T | undefined {
    return this.alepha.store.get(currentAuthorityAtom) as T | undefined;
  }
}
