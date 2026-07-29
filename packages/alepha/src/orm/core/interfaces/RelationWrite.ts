import type { Static, TObject } from "alepha";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type {
  EntitySchema,
  Relation,
  RelationMapFor,
  RowOf,
  SchemaOf,
} from "../primitives/$relations.ts";
import type { TObjectInsert } from "../schemas/insertSchema.ts";
import type { Repository } from "../services/Repository.ts";
import type { PgQueryWhere } from "./PgQueryWhere.ts";
import type { IncludeArg, RelationsFor } from "./RelationInclude.ts";

/** The plain insert shape for an entity. */
export type InsertOf<
  TSchema extends EntitySchema,
  K extends keyof TSchema,
> = Static<TObjectInsert<SchemaOf<TSchema, K>>>;

/** Make selected keys optional, leaving the rest untouched. */
type Optionalize<T, K extends PropertyKey> = Omit<T, K & keyof T> &
  Partial<Pick<T, K & keyof T>>;

/**
 * Columns that a nested write fills in for you.
 *
 * For a to-one relation the foreign key lives on *this* row, and is only known
 * once the related row exists — so it becomes optional here and is overwritten
 * on the way through.
 */
type FilledByNestedOne<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> = {
  [R in keyof RelationsFor<TSchema, TMap, K>]: RelationsFor<
    TSchema,
    TMap,
    K
  >[R] extends Relation<"one", any, infer TFrom, any>
    ? TFrom
    : never;
}[keyof RelationsFor<TSchema, TMap, K>];

/**
 * Data for a nested create.
 *
 * Scalars are the entity's normal insert shape, minus any foreign key a nested
 * to-one relation will supply. Each declared relation may additionally carry
 * `{ create: ... }`, recursively.
 *
 * The trade-off worth knowing: to-one foreign keys are optional on this type
 * whether or not you actually nest that relation, because the type cannot see
 * which keys the value will carry. Omitting one *without* nesting fails at the
 * database rather than at the compiler.
 */
export type CreateData<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> = Optionalize<InsertOf<TSchema, K>, FilledByNestedOne<TSchema, TMap, K>> & {
  [R in keyof RelationsFor<TSchema, TMap, K>]?: {
    create: RelationsFor<TSchema, TMap, K>[R] extends Relation<
      "many",
      infer T extends keyof TSchema & string,
      any,
      infer TTo
    >
      ? Array<ChildCreateData<TSchema, TMap, T, TTo>>
      : RelationsFor<TSchema, TMap, K>[R] extends Relation<
            "one",
            infer T extends keyof TSchema & string,
            any,
            any
          >
        ? CreateData<TSchema, TMap, T>
        : never;
  };
};

/**
 * A to-many child's data, without the foreign key pointing back at its parent
 * — that is filled from the parent row, so passing it would be ignored.
 */
type ChildCreateData<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
  TTo extends string,
> = Omit<CreateData<TSchema, TMap, K>, TTo>;

/** Arguments to a nested create. */
export interface CreateArgs<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> {
  data: CreateData<TSchema, TMap, K>;
  /** Re-read the created row with these relations resolved. */
  include?: IncludeArg<TSchema, TMap, K>;
  /** Project the returned row. */
  select?: ReadonlyArray<keyof RowOf<TSchema, K>>;
}

/** Arguments to `createMany`. */
export interface CreateManyArgs<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> {
  data: Array<CreateData<TSchema, TMap, K>>;
}

/**
 * The updatable shape for an entity.
 *
 * Derived from the plain repository's own parameter rather than rebuilt from
 * `TObjectUpdate`, because rebuilding it through a conditional `SchemaOf`
 * loses the partiality and silently demands every column. Reading it off the
 * method that will receive it also means the two cannot drift apart.
 */
export type UpdateOf<
  TSchema extends EntitySchema,
  K extends keyof TSchema,
> = Parameters<
  Repository<
    TSchema[K] extends EntityPrimitive<infer T extends TObject> ? T : never
  >["updateById"]
>[1];

/**
 * Arguments to `update`.
 *
 * `where` is mandatory. Making it optional would let a forgotten filter update
 * the whole table, which is not a mistake worth leaving reachable.
 */
export interface UpdateArgs<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> {
  where: PgQueryWhere<SchemaOf<TSchema, K>>;
  data: UpdateOf<TSchema, K>;
  include?: IncludeArg<TSchema, TMap, K>;
  select?: ReadonlyArray<keyof RowOf<TSchema, K>>;
}

/** Arguments to `updateMany`. */
export interface UpdateManyArgs<
  TSchema extends EntitySchema,
  K extends keyof TSchema,
> {
  where: PgQueryWhere<SchemaOf<TSchema, K>>;
  data: UpdateOf<TSchema, K>;
}

/**
 * Arguments to `upsert`.
 *
 * `create` is the row to insert; `update` is applied instead when `target`
 * already exists. Omitting `update` means "insert or leave alone".
 */
export interface UpsertArgs<
  TSchema extends EntitySchema,
  TMap extends RelationMapFor<TSchema>,
  K extends keyof TSchema,
> {
  create: InsertOf<TSchema, K>;
  update?: UpdateOf<TSchema, K>;
  /** Conflict target. Defaults to the primary key. */
  target?: Array<keyof RowOf<TSchema, K>>;
  include?: IncludeArg<TSchema, TMap, K>;
}

/** Arguments to `delete` / `deleteMany`. */
export interface DeleteArgs<
  TSchema extends EntitySchema,
  K extends keyof TSchema,
> {
  where: PgQueryWhere<SchemaOf<TSchema, K>>;
  /** Hard-delete a soft-deletable entity. */
  force?: boolean;
}
