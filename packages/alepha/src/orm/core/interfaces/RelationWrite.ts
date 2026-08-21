import type { Infer, ZObject } from "alepha";

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
export type InsertOf<ZType extends EntitySchema, K extends keyof ZType> = Infer<
  TObjectInsert<SchemaOf<ZType, K>>
>;

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
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> = {
  [R in keyof RelationsFor<ZType, TMap, K>]: RelationsFor<
    ZType,
    TMap,
    K
  >[R] extends Relation<"one", any, infer TFrom, any>
    ? TFrom
    : never;
}[keyof RelationsFor<ZType, TMap, K>];

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
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> = Optionalize<InsertOf<ZType, K>, FilledByNestedOne<ZType, TMap, K>> & {
  [R in keyof RelationsFor<ZType, TMap, K>]?: {
    create: RelationsFor<ZType, TMap, K>[R] extends Relation<
      "many",
      infer T extends keyof ZType & string,
      any,
      infer TTo
    >
      ? Array<ChildCreateData<ZType, TMap, T, TTo>>
      : RelationsFor<ZType, TMap, K>[R] extends Relation<
            "one",
            infer T extends keyof ZType & string,
            any,
            any
          >
        ? CreateData<ZType, TMap, T>
        : never;
  };
};

/**
 * A to-many child's data, without the foreign key pointing back at its parent
 * — that is filled from the parent row, so passing it would be ignored.
 */
type ChildCreateData<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
  TTo extends string,
> = Omit<CreateData<ZType, TMap, K>, TTo>;

/** Arguments to a nested create. */
export interface CreateArgs<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> {
  data: CreateData<ZType, TMap, K>;
  /** Re-read the created row with these relations resolved. */
  include?: IncludeArg<ZType, TMap, K>;
  /** Project the returned row. */
  select?: ReadonlyArray<keyof RowOf<ZType, K>>;
}

/** Arguments to `createMany`. */
export interface CreateManyArgs<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> {
  data: Array<CreateData<ZType, TMap, K>>;
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
  ZType extends EntitySchema,
  K extends keyof ZType,
> = Parameters<
  Repository<
    ZType[K] extends EntityPrimitive<infer T extends ZObject> ? T : never
  >["updateById"]
>[1];

/**
 * Arguments to `update`.
 *
 * `where` is mandatory. Making it optional would let a forgotten filter update
 * the whole table, which is not a mistake worth leaving reachable.
 */
export interface UpdateArgs<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> {
  where: PgQueryWhere<SchemaOf<ZType, K>>;
  data: UpdateOf<ZType, K>;
  include?: IncludeArg<ZType, TMap, K>;
  select?: ReadonlyArray<keyof RowOf<ZType, K>>;
}

/** Arguments to `updateMany`. */
export interface UpdateManyArgs<
  ZType extends EntitySchema,
  K extends keyof ZType,
> {
  where: PgQueryWhere<SchemaOf<ZType, K>>;
  data: UpdateOf<ZType, K>;
}

/**
 * Arguments to `upsert`.
 *
 * `create` is the row to insert; `update` is applied instead when `target`
 * already exists. Omitting `update` means "insert or leave alone".
 */
export interface UpsertArgs<
  ZType extends EntitySchema,
  TMap extends RelationMapFor<ZType>,
  K extends keyof ZType,
> {
  create: InsertOf<ZType, K>;
  update?: UpdateOf<ZType, K>;
  /** Conflict target. Defaults to the primary key. */
  target?: Array<keyof RowOf<ZType, K>>;
  include?: IncludeArg<ZType, TMap, K>;
}

/** Arguments to `delete` / `deleteMany`. */
export interface DeleteArgs<ZType extends EntitySchema, K extends keyof ZType> {
  where: PgQueryWhere<SchemaOf<ZType, K>>;
  /** Hard-delete a soft-deletable entity. */
  force?: boolean;
}
