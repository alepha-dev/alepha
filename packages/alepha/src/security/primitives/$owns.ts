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
      const from = options.from ?? "params";

      // `Record<string, unknown>`, not the declared `Record<string, string>`:
      // the guard runs after `validateRequest`, so a `z.integer()` param has
      // already been decoded to a number. Reading it as a string here was
      // only ever true of undeclared params.
      const source: Record<string, unknown> | undefined =
        from === "params"
          ? ctx.params
          : from === "query"
            ? ctx.query
            : (ctx.body as Record<string, unknown> | undefined);

      const value = source?.[options.param];

      // `null` counts as absent: it names no row, so gating on it would query
      // for `id = null` and then 404 with a message about a missing row
      // rather than a missing declaration.
      if (value === undefined || value === null) {
        throw new AlephaError(
          // Naming the source it actually searched, so a `from: "body"` typo
          // does not report a path problem the reader then goes looking for.
          `$owns: '${options.param}' is not present in the ${from} of this handler. ` +
            (from === "params"
              ? `Declare it in the path (e.g. "/things/:${options.param}").`
              : `Declare it in the ${from} schema, or correct \`from\`.`),
        );
      }

      // An id is a scalar. Request validation has already run by the time a
      // guard does, so a declared field cannot be anything else — but an
      // UNDECLARED one is whatever the caller sent, and `from: "body"` is the
      // source where that matters. Refusing here keeps an object out of the
      // query builder rather than finding out what it does with one.
      if (typeof value !== "string" && typeof value !== "number") {
        throw new AlephaError(
          `$owns: '${options.param}' in the ${from} of this handler is a ${typeof value}, not an id. ` +
            "Declare it in the schema so it is validated before the gate runs.",
        );
      }

      const raw = value;

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
   * Key holding the resource id, in whichever source {@link OwnsOptions.from}
   * names. A route param by default.
   */
  param: string;

  /**
   * Where to read {@link OwnsOptions.param} from.
   *
   * Defaults to `"params"`. An endpoint that takes its project id in the
   * query string or the request body could not be gated declaratively at all
   * before this existed, because the guard read `ctx.params` and nothing else.
   *
   * ```ts
   * $owns({ repository: () => this.projects, param: "projectId", from: "query", owner: "createdBy" })
   * ```
   *
   * A body value is caller-controlled in a way a path segment is not. That
   * widens nothing: it is still just an id handed to `findById`, and the gate
   * below is what decides access — a caller naming somebody else's project
   * gets a 403 for it.
   */
  from?: "params" | "query" | "body";

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
   * Coerce the raw value before querying.
   *
   * Rarely needed, and less so than the `string` in its old signature
   * suggested: the guard runs after request validation, so a declared
   * `z.integer()` param arrives already decoded to a number, and `findById`
   * coerces whatever is left to the primary key's declared type. Reach for it
   * when the value needs a transformation the schema cannot express (decoding
   * a slug, say).
   *
   * The `via` membership lookup receives the same coerced value.
   */
  cast?: (raw: unknown) => unknown;

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
