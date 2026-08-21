import { $inject, Alepha, AlephaError } from "alepha";

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
}
