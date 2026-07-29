import type { Static, TObject } from "alepha";
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
 * The `() => any` in `db.ref` is load-bearing — that `any` is what breaks the
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
 * const schema = { users, campaigns, characters };
 *
 * export const relations = $relations(schema, (r) => ({
 *   campaigns: {
 *     characters: r.many.characters({
 *       from: r.campaigns.id,
 *       to: r.characters.campaignId,
 *     }),
 *   },
 *   characters: {
 *     campaign: r.one.campaigns({
 *       from: r.characters.campaignId,
 *       to: r.campaigns.id,
 *     }),
 *   },
 * }));
 * ```
 */
export const $relations = <
  const TSchema extends EntitySchema,
  const TMap extends RelationMapFor<TSchema>,
>(
  schema: TSchema,
  define: (builders: RelationBuilders<TSchema>) => TMap,
): RelationsPrimitive<TSchema, TMap> => {
  const builders: any = { one: {}, many: {} };

  for (const key of Object.keys(schema)) {
    // Column refs: `r.campaigns.id` -> { entity: "campaigns", column: "id" }.
    // A Proxy avoids walking every entity's schema up front, and means a
    // typo is caught by the type system rather than by a missing key here.
    builders[key] = new Proxy(
      {},
      { get: (_, column: string) => ({ entity: key, column }) },
    );

    for (const kind of ["one", "many"] as const) {
      builders[kind][key] = (on: {
        from: ColumnRefValue;
        to: ColumnRefValue;
      }) =>
        ({
          kind,
          target: key,
          from: on.from.column,
          to: on.to.column,
        }) satisfies ResolvedRelation;
    }
  }

  return { schema, map: define(builders) };
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A map of key to entity — the same shape `defineRelations` takes. These keys
 * are how relations address one another, and how `include` results are named.
 */
export type EntitySchema = Record<string, EntityPrimitive<any>>;

export interface RelationsPrimitive<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
> {
  schema: TSchema;
  map: TMap;
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
}

export interface Relation<TKind extends "one" | "many", TTarget extends string>
  extends ResolvedRelation {
  kind: TKind;
  target: TTarget;
}

export type AnyRelation = Relation<"one" | "many", string>;
export type RelationsOf = Record<string, AnyRelation>;

export type RelationMapFor<TSchema extends EntitySchema> = {
  [K in keyof TSchema]?: Record<
    string,
    Relation<"one" | "many", keyof TSchema & string>
  >;
};

/** The row type of an entity in the schema. */
export type RowOf<TSchema extends EntitySchema, K extends keyof TSchema> =
  TSchema[K] extends EntityPrimitive<infer T extends TObject>
    ? Static<T>
    : never;

interface ColumnRefValue {
  entity: string;
  column: string;
}

/**
 * A typed reference to one column, e.g. `r.campaigns.id`.
 *
 * `TValue` is what makes a mismatched join a compile error: `from` and `to`
 * must agree on it, so pairing a `string` column with an `integer` one does
 * not typecheck.
 */
export interface ColumnRef<TEntity extends string, TValue>
  extends ColumnRefValue {
  entity: TEntity;
  /** Phantom — carries the column's value type for inference only. */
  __value?: TValue;
}

/** `r.<entity>.<column>` refs for every entity in the schema. */
export type ColumnRefs<TSchema extends EntitySchema> = {
  [K in keyof TSchema & string]: {
    [C in keyof RowOf<TSchema, K>]-?: ColumnRef<
      K,
      NonNullable<RowOf<TSchema, K>[C]>
    >;
  };
};

export type RelationBuilders<TSchema extends EntitySchema> =
  ColumnRefs<TSchema> & {
    /**
     * A to-one relation. Resolves to `Target | undefined` — undefined when
     * the foreign key is null or no row matches.
     */
    one: {
      [K in keyof TSchema & string]: <TValue>(on: {
        from: ColumnRef<string, TValue>;
        to: ColumnRef<K, TValue>;
      }) => Relation<"one", K>;
    };

    /**
     * A to-many relation. Resolves to `Target[]`, empty when nothing matches.
     */
    many: {
      [K in keyof TSchema & string]: <TValue>(on: {
        from: ColumnRef<string, TValue>;
        to: ColumnRef<K, TValue>;
      }) => Relation<"many", K>;
    };
  };
