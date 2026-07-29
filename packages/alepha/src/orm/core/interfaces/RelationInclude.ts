import type {
  AnyRelation,
  EntitySchema,
  Relation,
  RelationMapFor,
  RowOf,
} from "../primitives/$relations.ts";

/**
 * The relations declared for one entity, or `{}` when it has none.
 *
 * Every lookup goes through here so an entity absent from the relation map is
 * a normal case (no relations to include) rather than a type error.
 */
export type RelationsFor<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> = K extends keyof TMap
  ? TMap[K] extends Record<string, AnyRelation>
    ? TMap[K]
    : {}
  : {};

/** The schema key a relation points at. */
export type TargetOf<R> = R extends Relation<any, infer T> ? T : never;

/**
 * What `include` accepts: any declared relation, either `true` or an object
 * that nests further.
 *
 * Because it is keyed by the declared relations, `include: { author: true }`
 * on an entity with no `author` relation is a compile error rather than a
 * silent undefined at runtime.
 */
export type IncludeArg<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> = {
  [R in keyof RelationsFor<TSchema, TMap, K>]?:
    | true
    | {
        include?: IncludeArg<
          TSchema,
          TMap,
          TargetOf<RelationsFor<TSchema, TMap, K>[R]> & keyof TSchema
        >;
      };
};

/** Pull the nested `include` out of a relation's argument, if any. */
type NestedInclude<TArg> = TArg extends { include: infer I } ? I : {};

/**
 * The row type plus exactly the relations that were included — nothing more.
 *
 * A relation you did not ask for is absent from the type, so reading it is a
 * compile error rather than `undefined` at runtime. `many` yields an array,
 * `one` yields `T | undefined` (the foreign key may be null, or the row may
 * have been deleted).
 */
export type WithIncludes<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
  TInclude,
> = RowOf<TSchema, K> & {
  [R in keyof TInclude & keyof RelationsFor<TSchema, TMap, K>]: RelationsFor<
    TSchema,
    TMap,
    K
  >[R] extends Relation<"many", infer T extends keyof TSchema & string>
    ? Array<WithIncludes<TSchema, TMap, T, NestedInclude<TInclude[R]>>>
    : RelationsFor<TSchema, TMap, K>[R] extends Relation<
          "one",
          infer T extends keyof TSchema & string
        >
      ? WithIncludes<TSchema, TMap, T, NestedInclude<TInclude[R]>> | undefined
      : never;
};
