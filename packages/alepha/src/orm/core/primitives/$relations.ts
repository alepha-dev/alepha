import { AlephaError, type Infer, type ZObject } from "alepha";

import type { EntityPrimitive } from "./$entity.ts";

/**
 * Declares how entities relate to one another.
 *
 * Relations live in their own statement, after the entities they connect.
 * They cannot be attached to `$entity`, and they cannot be derived from
 * `db.ref()`. That is a hard TypeScript limitation, not a style choice:
 * threading a foreign key's target through the column type makes
 * `quests.dependsOn -> quests.id` (a self reference) and every mutual
 * reference fail with
 *
 *   TS7022: 'quests' implicitly has type 'any' because it is referenced
 *           directly or indirectly in its own initializer
 *
 * The `() => any` in `db.ref` is load-bearing - that `any` is what breaks the
 * cycle. Declaring relations separately, once every entity's type has already
 * resolved, is the only shape that preserves full inference. Drizzle's
 * `defineRelations` and Prisma's codegen both land here for the same reason.
 *
 * The shape deliberately mirrors `defineRelations` so the resolver behind it
 * can later be swapped for Drizzle's relational query builder without moving
 * a single call site.
 *
 * @example
 * ```ts
 * const schema = { users, campaigns, characters, usersToGroups, groups };
 *
 * export const relations = $relations(schema, (r) => ({
 *   campaigns: {
 *     characters: r.many.characters({
 *       from: r.campaigns.id,
 *       to: r.characters.campaignId,
 *     }),
 *   },
 *   users: {
 *     // many-to-many, through a junction table
 *     groups: r.many.groups({
 *       from: r.users.id.through(r.usersToGroups.userId),
 *       to: r.groups.id.through(r.usersToGroups.groupId),
 *     }),
 *   },
 * }));
 * ```
 */
export const $relations = <
  const ZType extends EntitySchema,
  const TMap extends RelationMapFor<ZType>,
>(
  schema: ZType,
  define: (builders: RelationBuilders<ZType>) => TMap,
): RelationsPrimitive<ZType, TMap> => {
  const builders: any = { one: {}, many: {} };

  for (const key of Object.keys(schema)) {
    // `r.campaigns.id` -> a ref carrying its own `through()`. A Proxy avoids
    // walking every entity's schema up front, and a typo is caught by the
    // type system rather than by a missing key here.
    builders[key] = new Proxy(
      {},
      { get: (_, column: string) => makeColumnRef(key, column) },
    );

    for (const kind of ["one", "many"] as const) {
      builders[kind][key] = (on: {
        from: ColumnRefValue;
        to: ColumnRefValue;
      }): ResolvedRelation => ({
        kind,
        target: key,
        from: on.from.column,
        to: on.to.column,
        // Both sides must agree on the junction table, and each names its own
        // column on it. An un-hopped ref still carries `through` — as the
        // *method* — so the check is for an object, not for presence.
        through: junctionOf(on.from, on.to),
      });
    }
  }

  return { schema, map: define(builders) };
};

/**
 * Extract the junction, if both sides were hopped.
 *
 * Hopping only one side is a declaration error rather than a half-configured
 * relation: the resolver would have no column to match on the other side, and
 * would silently return nothing.
 */
const junctionOf = (
  from: ColumnRefValue,
  to: ColumnRefValue,
): RelationThrough | undefined => {
  const fromHop = asHop(from.through);
  const toHop = asHop(to.through);

  if (!fromHop && !toHop) return undefined;

  if (!fromHop || !toHop) {
    throw new AlephaError(
      "A many-to-many relation must call .through() on both sides — one side alone leaves no column to match on the other.",
    );
  }

  if (fromHop.entity !== toHop.entity) {
    throw new AlephaError(
      `Both sides of a many-to-many must go through the same junction, got '${fromHop.entity}' and '${toHop.entity}'.`,
    );
  }

  return {
    entity: fromHop.entity,
    fromColumn: fromHop.column,
    toColumn: toHop.column,
  };
};

const asHop = (
  value: unknown,
): { entity: string; column: string } | undefined =>
  value && typeof value === "object" ? (value as any) : undefined;

/**
 * A column ref that can hop through a junction column.
 *
 * `through()` returns a *new* ref rather than mutating this one, because the
 * Proxy hands out a fresh object per access and a shared mutable ref would
 * leak a junction from one relation into the next.
 */
const makeColumnRef = (entity: string, column: string) => ({
  entity,
  column,
  through: (via: { entity: string; column: string }) => ({
    entity,
    column,
    through: { entity: via.entity, column: via.column },
  }),
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A map of key to entity — the same shape `defineRelations` takes. These keys
 * are how relations address one another, and how `include` results are named.
 */
export type EntitySchema = Record<string, EntityPrimitive<any>>;

export interface RelationsPrimitive<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
> {
  schema: ZType;
  map: TMap;
}

/**
 * How a many-to-many hop crosses its junction table.
 */
export interface RelationThrough {
  /** The junction entity's key in the schema. */
  entity: string;
  /** Junction column matching the owner's `from`. */
  fromColumn: string;
  /** Junction column matching the target's `to`. */
  toColumn: string;
}

/**
 * A relation as stored at runtime. `target` is the entity's key in the
 * schema, which is what lets a nested `include` find the target's own
 * relations without a structural reverse lookup.
 */
export interface ResolvedRelation {
  kind: "one" | "many";
  target: string;
  from: string;
  to: string;
  through?: RelationThrough;
}

export interface Relation<
  TKind extends "one" | "many",
  TTarget extends string,
  TFrom extends string = string,
  TTo extends string = string,
> extends ResolvedRelation {
  kind: TKind;
  target: TTarget;
  /** Column on the owning entity. */
  from: TFrom;
  /** Column on the target entity — the one a nested write fills in. */
  to: TTo;
}

export type AnyRelation = Relation<"one" | "many", string, string, string>;
export type RelationsOf = Record<string, AnyRelation>;

export type RelationMapFor<ZType extends EntitySchema> = {
  [K in keyof ZType]?: Record<
    string,
    Relation<"one" | "many", keyof ZType & string, string, string>
  >;
};

/** The row type of an entity in the schema. */
export type RowOf<ZType extends EntitySchema, K extends keyof ZType> =
  ZType[K] extends EntityPrimitive<infer T extends ZObject> ? Infer<T> : never;

/** The schema (not the row type) of an entity in the schema map. */
export type SchemaOf<ZType extends EntitySchema, K extends keyof ZType> =
  ZType[K] extends EntityPrimitive<infer T extends ZObject> ? T : never;

export interface ColumnRefValue {
  entity: string;
  column: string;
  /**
   * Either the `through()` method (un-hopped) or the recorded junction column
   * (hopped). `junctionOf` narrows it.
   */
  through?: unknown;
}

/**
 * A typed reference to one column, e.g. `r.campaigns.id`.
 *
 * `TValue` is what makes a mismatched join a compile error: `from` and `to`
 * must agree on it, so pairing a `string` column with an `integer` one does
 * not typecheck.
 */
export interface ColumnRef<
  TEntity extends string,
  TColumn extends string,
  TValue,
> {
  entity: TEntity;
  column: TColumn;
  through?: { entity: string; column: string };
  /** Phantom — carries the column's value type for inference only. */
  __value?: TValue;
  /**
   * Route this side of a many-to-many through a junction column.
   *
   * The junction column must carry the same value type as this one, so a
   * junction wired to the wrong column does not compile.
   */
  through_?: never;
}

/**
 * A ref routed through a junction column.
 *
 * Branded so the builder can tell the two cases apart. It matters: a direct
 * relation requires both sides to carry the *same* value type (a foreign key
 * and the column it points at), whereas the two sides of a many-to-many are
 * linked only through the junction and are routinely different types — here,
 * a uuid on one side and an integer on the other.
 */
export interface HoppedColumnRef<
  TEntity extends string,
  TColumn extends string,
  TValue,
> extends ColumnRef<TEntity, TColumn, TValue> {
  readonly __hopped: true;
}

/** A column ref that can additionally hop through a junction table. */
export type HoppableColumnRef<
  TEntity extends string,
  TColumn extends string,
  TValue,
> = ColumnRef<TEntity, TColumn, TValue> & {
  /**
   * Route this side through a junction column. The junction column must carry
   * this side's value type, so a junction wired to the wrong column does not
   * compile.
   */
  through(
    via: ColumnRef<string, string, TValue>,
  ): HoppedColumnRef<TEntity, TColumn, TValue>;
};

/**
 * Builds one relation. Two shapes, and the order matters — the junction case
 * is tried first, because a hopped ref also satisfies the direct signature and
 * would otherwise be rejected for having mismatched value types.
 */
export interface RelationFactory<
  TKind extends "one" | "many",
  K extends string,
> {
  <TFrom extends string, TTo extends string, TFromValue, TToValue>(on: {
    from: HoppedColumnRef<string, TFrom, TFromValue>;
    to: HoppedColumnRef<K, TTo, TToValue>;
  }): Relation<TKind, K, TFrom, TTo>;

  <TValue, TFrom extends string, TTo extends string>(on: {
    from: ColumnRef<string, TFrom, TValue>;
    to: ColumnRef<K, TTo, TValue>;
  }): Relation<TKind, K, TFrom, TTo>;
}

/** `r.<entity>.<column>` refs for every entity in the schema. */
export type ColumnRefs<ZType extends EntitySchema> = {
  [K in keyof ZType & string]: {
    [C in keyof RowOf<ZType, K> & string]-?: HoppableColumnRef<
      K,
      C,
      NonNullable<RowOf<ZType, K>[C]>
    >;
  };
};

export type RelationBuilders<ZType extends EntitySchema> = ColumnRefs<ZType> & {
  /**
   * A to-one relation. Resolves to `Target | undefined` — undefined when
   * the foreign key is null or no row matches.
   */
  one: {
    [K in keyof ZType & string]: RelationFactory<"one", K>;
  };

  /**
   * A to-many relation. Resolves to `Target[]`, empty when nothing matches.
   *
   * Pass `.through(...)` on both sides for many-to-many.
   */
  many: {
    [K in keyof ZType & string]: RelationFactory<"many", K>;
  };
};
