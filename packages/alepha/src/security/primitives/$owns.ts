import { $context, AlephaError, type Middleware } from "alepha";
// Type-only on purpose. `alepha/orm` already imports `alepha/security` for its
// tenant/user atoms, so a value import here would close a runtime cycle and
// leave one module's exports undefined depending on which is evaluated first.
// Erased at compile time, this edge does not exist at runtime.
import type { Repository } from "alepha/orm";
import { ForbiddenError, NotFoundError } from "alepha/server";

import { currentAuthorityAtom } from "../atoms/currentAuthorityAtom.ts";
import { currentResourceAtom } from "../atoms/currentResourceAtom.ts";
import { $secure, type SecureOptions } from "./$secure.ts";

/**
 * Resource-scoped authorization gate.
 *
 * Roles and permissions answer "what kind of user is this?". They cannot
 * answer "does this user own row 42?", so that check ends up inline in every
 * handler - where nothing enforces its presence and a forgotten call is a
 * silent authorization hole.
 *
 * `$owns` loads the row named by a route param, checks the caller against it,
 * and publishes it via `OwnedResourceProvider` so the handler does not
 * re-fetch what the gate already read.
 *
 * Two checks, applied in order:
 *
 * 1. **Owner**: `row[owner] === user.id`.
 * 2. **Membership**: when `via` is set, a row in the join entity links the
 *    caller to this resource.
 *
 * Both are read off the row the param names, unless `through` says ownership
 * lives one hop away — on the project a quest belongs to, say. The resource
 * is still published to `OwnedResourceProvider.get()`; the row the decision
 * was actually made against is published to `authority()`.
 *
 * A privileged identity (`user.ownership === false`) bypasses both, matching
 * the `ownership` semantics `$secure` already applies: an admin whose grant is
 * not narrowed to rows they own. Note this is deliberately strict - an
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

      // The row the decision is made against. Without `through` it is the row
      // the param names; with it, the row that row belongs to.
      let authority = row as Record<string, unknown>;
      let authorityId = id;

      if (options.through) {
        // A foreign key is a scalar by definition; the cast states that
        // rather than letting `unknown` leak into the query and the message.
        const foreignKey = authority[options.through.column] as
          | string
          | number
          | null
          | undefined;

        // A null FK DENIES. Falling through to the checks below would compare
        // `undefined` against the caller's id and then query the join entity
        // for `projectId = null`, so an orphan row would be refused only by
        // accident — and a `via`-less gate whose `owner` column is also empty
        // would allow. An orphan must never become world-readable.
        if (foreignKey === undefined || foreignKey === null) {
          throw new ForbiddenError(
            options.message ?? "Not a member of this resource",
          );
        }

        const authorityRepository = options.through.repository();
        const found = await authorityRepository.findById(foreignKey);

        if (!found) {
          throw new NotFoundError(
            `${authorityRepository.tableName} '${foreignKey}' not found`,
          );
        }

        authority = found as Record<string, unknown>;
        authorityId = foreignKey;
      }

      alepha.store.set(currentAuthorityAtom, authority);

      if (ctx.user.ownership === false) {
        return true;
      }

      if (authority[options.owner] === ctx.user.id) {
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
          // `authorityId`, not `id`: with `through` the membership rows point
          // at the authority (the project), never at the row the param names.
          [options.via.resource]: { eq: authorityId },
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
   * The second hop: say that ownership is not held by the row the param
   * names, but by a row it belongs to.
   *
   * Without it, `owner` and `via` are read off the row `repository` loaded —
   * which only works when the param names the thing being shared. When the
   * param names a quest and membership lives on its project, there is no join
   * to make and the rule cannot be expressed at all.
   *
   * ```ts
   * $owns({
   *   repository: () => this.quests,   // the row the param names
   *   param: "id",
   *   through: { column: "projectId", repository: () => this.projects },
   *   owner: "createdBy",              // read off the PROJECT
   *   via: { repository: () => this.members, resource: "projectId", user: "userId" },
   * })
   * ```
   *
   * `owner` and `via` keep their meaning; they simply apply to the row this
   * lands on. `via.resource` is matched against the foreign key's value, not
   * against the param.
   *
   * A null or absent foreign key **denies**: an orphan row must not become
   * world-readable. A missing authority row is a `NotFoundError`, like a
   * missing resource.
   *
   * One hop only. Chains can be added when something needs one.
   */
  through?: {
    /**
     * Column on the resource holding the authority row's id.
     */
    column: string;

    /**
     * Repository the authority row is loaded from, as a thunk — same
     * reasoning as {@link OwnsOptions.repository}.
     */
    repository: () => Repository<any>;
  };

  /**
   * Column holding the owner's user id, on the row the decision is made
   * against — the resource itself, or the row `through` lands on.
   */
  owner: string;

  /**
   * Membership fallback: a join entity linking users to the row the decision
   * is made against. Omit for owner-only resources.
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
   * Additional `$secure` checks layered on top - roles, permissions, issuers.
   */
  secure?: Omit<SecureOptions, "guard">;
}
