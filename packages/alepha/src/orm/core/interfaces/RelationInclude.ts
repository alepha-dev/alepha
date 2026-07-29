import type { Static } from "alepha";
import type {
  AnyRelation,
  EntitySchema,
  Relation,
  RelationMapFor,
  RowOf,
  SchemaOf,
} from "../primitives/$relations.ts";
import type { OrderBy } from "./PgQuery.ts";
import type { PgQueryWhere } from "./PgQueryWhere.ts";

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
 * Everything that can be asked of a relation: filter it, order it, cap it,
 * project it, and nest further.
 *
 * This is the same shape as a root query, which is deliberate — a relation is
 * a query, and there is no reason to learn two vocabularies.
 */
export interface RelationArgs<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> {
  where?: PgQueryWhere<SchemaOf<TSchema, K>>;
  orderBy?: OrderBy<RowOf<TSchema, K>>;
  /**
   * Cap the rows returned **per parent**, not across the batch.
   *
   * Prisma's `take` means the same thing, and here it is a real `limit` on
   * the relation's own subquery rather than a slice taken afterwards — so a
   * capped relation reads only what it returns.
   */
  limit?: number;
  /** Project the relation's rows. Narrows the result type too. */
  select?: ReadonlyArray<keyof RowOf<TSchema, K>>;
  include?: IncludeArg<TSchema, TMap, K>;
}

/**
 * What `include` accepts: any declared relation, either `true` or an object
 * that filters, orders, projects, or nests further.
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
    | RelationArgs<
        TSchema,
        TMap,
        TargetOf<RelationsFor<TSchema, TMap, K>[R]> & keyof TSchema
      >;
};

/** `true` carries no options; anything else is the options object. */
type ArgsOf<TArg> = TArg extends true ? {} : TArg;

/** The `include` map inside a relation's arguments, if any. */
type IncludeOf<TArgs> = TArgs extends { include: infer I } ? I : {};

/**
 * Narrow a row to its projected columns.
 *
 * This is what closes the gap where `columns:` narrowed the runtime row but
 * not the type, so the compiler kept promising fields that had already been
 * stripped.
 */
export type Projected<TRow, TArgs> = TArgs extends {
  select: ReadonlyArray<infer S>;
}
  ? Pick<TRow, S & keyof TRow>
  : TRow;

/**
 * The row type — projected if `select` was given — plus exactly the relations
 * that were included, recursively.
 *
 * A relation you did not ask for is absent from the type, so reading it is a
 * compile error rather than `undefined` at runtime. `many` yields an array,
 * `one` yields `T | undefined` (the foreign key may be null, or the row may
 * have been deleted).
 */
export type Resolve<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
  TArgs,
> = Projected<RowOf<TSchema, K>, TArgs> & {
  [R in keyof IncludeOf<TArgs> &
    keyof RelationsFor<TSchema, TMap, K>]: RelationsFor<
    TSchema,
    TMap,
    K
  >[R] extends Relation<"many", infer T extends keyof TSchema & string>
    ? Array<Resolve<TSchema, TMap, T, ArgsOf<IncludeOf<TArgs>[R]>>>
    : RelationsFor<TSchema, TMap, K>[R] extends Relation<
          "one",
          infer T extends keyof TSchema & string
        >
      ? Resolve<TSchema, TMap, T, ArgsOf<IncludeOf<TArgs>[R]>> | undefined
      : never;
};

/**
 * Kept as the previous name so existing call sites and docs still resolve.
 */
export type WithIncludes<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
  TInclude,
> = Resolve<TSchema, TMap, K, { include: TInclude }>;

/** A root query: the relation vocabulary plus paging. */
export interface RelationalQueryArgs<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> {
  where?: PgQueryWhere<SchemaOf<TSchema, K>>;
  orderBy?: OrderBy<Static<SchemaOf<TSchema, K>>>;
  limit?: number;
  offset?: number;
  select?: ReadonlyArray<keyof RowOf<TSchema, K>>;
  include?: IncludeArg<TSchema, TMap, K>;
}
