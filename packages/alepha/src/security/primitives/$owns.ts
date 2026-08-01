import { $context, AlephaError, type Middleware } from "alepha";
// Type-only on purpose. `alepha/orm` already imports `alepha/security` for its
// tenant/user atoms, so a value import here would close a runtime cycle and
// leave one module's exports undefined depending on which is evaluated first.
// Erased at compile time, this edge does not exist at runtime.
import type { Repository } from "alepha/orm";
import { ForbiddenError, NotFoundError } from "alepha/server";
import { currentResourceAtom } from "../atoms/currentResourceAtom.ts";
import { $secure, type SecureOptions } from "./$secure.ts";

/**
 * Resource-scoped authorization gate.
 *
 * Roles and permissions answer "what kind of user is this?". They cannot
 * answer "does this user own row 42?", so that check ends up inline in every
 * handler — where nothing enforces its presence and a forgotten call is a
 * silent authorization hole.
 *
 * `$owns` loads the row named by a route param, checks the caller against it,
 * and publishes it via `OwnedResourceProvider` so the handler does not
 * re-fetch what the gate already read.
 *
 * Two checks, applied in order:
 *
 * 1. **Owner** — `row[owner] === user.id`.
 * 2. **Membership** — when `via` is set, a row in the join entity links the
 *    caller to this resource.
 *
 * A privileged identity (`user.ownership === false`) bypasses both, matching
 * the `ownership` semantics `$secure` already applies: an admin whose grant is
 * not narrowed to rows they own. Note this is deliberately strict — an
 * `undefined` ownership does **not** bypass, because `undefined` only means
 * "no permission check ran", not "this caller is privileged".
 *
 * ```typescript
 * class CampaignController {
 *   read = $action({
 *     path: "/campaigns/:id",
 *     use: [
 *       $secure(),
 *       $owns({
 *         repository: () => this.campaigns,
 *         param: "id",
 *         owner: "createdBy",
 *         cast: Number,
 *         via: {
 *           repository: () => this.characters,
 *           resource: "campaignId",
 *           user: "userId",
 *         },
 *       }),
 *     ],
 *     handler: async () => this.owned.get<Campaign>(),
 *   });
 * }
 * ```
 */
export function $owns(options: OwnsOptions): Middleware {
  const { alepha } = $context();

  return $secure({
    ...options.secure,
    guard: async (ctx) => {
      const raw = ctx.params[options.param];

      if (raw === undefined) {
        throw new AlephaError(
          `$owns: route param '${options.param}' is not present on this handler. ` +
            `Declare it in the path (e.g. "/things/:${options.param}").`,
        );
      }

      const repository = options.repository();
      const id = options.cast ? options.cast(raw) : raw;
      // `findById` resolves the entity's OWN primary-key column (and coerces
      // the raw param to its declared type). Hardcoding `{ id: { eq } }` here
      // crashed with "Column 'id' not found" on every entity whose key is
      // named anything else — at runtime only, since the where was cast away.
      const row = await repository.findById(id as string | number);

      if (!row) {
        throw new NotFoundError(`${repository.tableName} '${raw}' not found`);
      }

      // Published before the access decision so the handler reads identically
      // on the owner, member, and privileged paths.
      alepha.store.set(currentResourceAtom, row as Record<string, unknown>);

      if (ctx.user.ownership === false) {
        return true;
      }

      if ((row as Record<string, unknown>)[options.owner] === ctx.user.id) {
        return true;
      }

      if (!options.via) {
        throw new ForbiddenError(
          options.message ?? "Not the owner of this resource",
        );
      }

      const link = options.via.repository();
      const membership = await link.findOne({
        where: {
          [options.via.resource]: { eq: id },
          [options.via.user]: { eq: ctx.user.id },
        },
      } as any);

      if (!membership) {
        throw new ForbiddenError(
          options.message ?? "Not a member of this resource",
        );
      }

      return true;
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

export interface OwnsOptions {
  /**
   * Repository the guarded resource is loaded from, as a thunk.
   *
   * A thunk rather than the repository itself because `$owns()` is evaluated
   * during class-field initialization, where a sibling `$repository()` field
   * declared *after* this one does not exist yet. Deferring the lookup to
   * request time makes field order irrelevant.
   *
   * ```ts
   * repository: () => this.campaigns
   * ```
   */
  repository: () => Repository<any>;

  /**
   * Route param holding the resource id.
   */
  param: string;

  /**
   * Column on the resource holding the owner's user id.
   */
  owner: string;

  /**
   * Membership fallback: a join entity linking users to resources. Omit for
   * owner-only resources.
   */
  via?: {
    /**
     * The join repository, as a thunk — same reasoning as `repository`.
     */
    repository: () => Repository<any>;

    /**
     * Column on the join entity referencing the resource id.
     */
    resource: string;

    /**
     * Column on the join entity referencing the user id.
     */
    user: string;
  };

  /**
   * Coerce the raw string route param before querying.
   *
   * Rarely needed: the resource lookup goes through `findById`, which already
   * coerces the value to the primary key's declared type, so an integer key
   * works without a `cast: Number`. Reach for it when the param needs a
   * transformation the schema cannot express (decoding a slug, say).
   *
   * The `via` membership lookup receives the same coerced value.
   */
  cast?: (raw: string) => unknown;

  /**
   * Message used for both the owner and the membership denial. Keep it
   * identical for both on purpose: a different message per branch tells an
   * attacker whether the resource exists and who owns it.
   */
  message?: string;

  /**
   * Additional `$secure` checks layered on top — roles, permissions, issuers.
   */
  secure?: Omit<SecureOptions, "guard">;
}
