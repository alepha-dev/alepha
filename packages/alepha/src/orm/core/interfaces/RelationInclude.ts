import type { Infer } from "alepha";

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
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
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
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> {
  where?: WhereArg<ZType, TMap, K>;
  orderBy?: OrderBy<RowOf<ZType, K>>;
  /**
   * Read rows the repository would normally hide.
   *
   * Today that means soft-deleted ones: `deletedAt` is filtered out of every
   * read, and some views want the history anyway — a blight inbox still shows
   * crashes reported by a sigil that has since been revoked. It is the same
   * flag the plain repository takes, and it applies to this level only, so a
   * parent can ask for deleted rows without its relations doing the same.
   */
  force?: boolean;

  /**
   * Cap the rows returned **per parent**, not across the batch.
   *
   * Prisma's `take` means the same thing, and here it is a real `limit` on
   * the relation's own subquery rather than a slice taken afterwards — so a
   * capped relation reads only what it returns.
   */
  limit?: number;
  /** Project the relation's rows. Narrows the result type too. */
  select?: ReadonlyArray<keyof RowOf<ZType, K>>;
  include?: IncludeArg<ZType, TMap, K>;
}

/**
 * A `where` that can also name a relation.
 *
 * Column filters are unchanged; a key that matches a declared relation takes
 * a nested `where` describing the related rows, and compiles to an `EXISTS`.
 * `{}` is meaningful — it means "has at least one", scoped by whatever the
 * target entity hides.
 *
 * Only the top level accepts relation keys. Inside `and` / `or` / `not` they
 * are refused at runtime, because that branch is compiled to one SQL
 * expression and an `EXISTS` cannot be folded into it.
 */
export type WhereArg<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> = PgQueryWhere<SchemaOf<ZType, K>> & {
  [R in keyof RelationsFor<ZType, TMap, K>]?: WhereArg<
    ZType,
    TMap,
    TargetOf<RelationsFor<ZType, TMap, K>[R]> & keyof ZType
  >;
};

/**
 * What `include` accepts: any declared relation, either `true` or an object
 * that filters, orders, projects, or nests further.
 *
 * Because it is keyed by the declared relations, `include: { author: true }`
 * on an entity with no `author` relation is a compile error rather than a
 * silent undefined at runtime.
 */
export type IncludeArg<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> = {
  [R in keyof RelationsFor<ZType, TMap, K>]?:
    | true
    | RelationArgs<
        ZType,
        TMap,
        TargetOf<RelationsFor<ZType, TMap, K>[R]> & keyof ZType
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
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
  TArgs,
> = Projected<RowOf<ZType, K>, TArgs> & {
  [
    R in keyof IncludeOf<TArgs> & keyof RelationsFor<ZType, TMap, K>
  ]: RelationsFor<ZType, TMap, K>[R] extends Relation<
    "many",
    infer T extends keyof ZType & string
  >
    ? Array<Resolve<ZType, TMap, T, ArgsOf<IncludeOf<TArgs>[R]>>>
    : RelationsFor<ZType, TMap, K>[R] extends Relation<
          "one",
          infer T extends keyof ZType & string
        >
      ? Resolve<ZType, TMap, T, ArgsOf<IncludeOf<TArgs>[R]>> | undefined
      : never;
};

/**
 * Kept as the previous name so existing call sites and docs still resolve.
 */
export type WithIncludes<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
  TInclude,
> = Resolve<ZType, TMap, K, { include: TInclude }>;

/** A root query: the relation vocabulary plus paging. */
export interface RelationalQueryArgs<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> {
  where?: WhereArg<ZType, TMap, K>;
  orderBy?: OrderBy<Infer<SchemaOf<ZType, K>>>;
  limit?: number;
  offset?: number;
  /**
   * Read rows the repository would normally hide.
   *
   * Today that means soft-deleted ones: `deletedAt` is filtered out of every
   * read, and some views want the history anyway — a blight inbox still shows
   * crashes reported by a sigil that has since been revoked. It is the same
   * flag the plain repository takes, and it applies to this level only, so a
   * parent can ask for deleted rows without its relations doing the same.
   */
  force?: boolean;

  select?: ReadonlyArray<keyof RowOf<ZType, K>>;
  include?: IncludeArg<ZType, TMap, K>;
}
