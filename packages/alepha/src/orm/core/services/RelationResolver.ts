import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import type {
  EntitySchema,
  RelationMapFor,
  ResolvedRelation,
} from "../primitives/$relations.ts";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";

/**
 * Loads declared relations onto already-fetched rows.
 *
 * The strategy is one batched query per included relation — collect the join
 * values across every parent row, fetch the matching children in a single
 * `inArray`, then stitch them back by key. That is exactly the access pattern
 * applications hand-write today; this just stops them writing it.
 *
 * Deliberately *not* a SQL join. A join against a to-many relation multiplies
 * parent rows by their children, so the parent has to be de-duplicated back
 * out afterwards — and on a `limit`ed query the multiplication silently
 * truncates the wrong thing. Batching sidesteps both, behaves identically on
 * every dialect (including D1, where a lateral join is not available), and
 * keeps the query count proportional to the number of *relations*, not rows.
 *
 * Nothing here is stored on the instance. The resolver is a shared singleton,
 * so per-resolution state would be shared across concurrent requests.
 */
export class RelationResolver {
  protected readonly log = $logger();
  protected readonly repositories = $inject(RepositoryProvider);

  /**
   * Resolve `include` against `rows`, mutating each row to carry its
   * relations. Recurses for nested includes.
   */
  public async resolve(ctx: ResolveContext): Promise<void> {
    const { rows, entityKey, include, map } = ctx;

    if (rows.length === 0) return;

    const declared = (map as any)[entityKey] as
      | Record<string, ResolvedRelation>
      | undefined;

    for (const name of Object.keys(include)) {
      const arg = include[name];
      if (arg === undefined || arg === false) continue;

      const relation = declared?.[name];
      if (!relation) {
        // Unreachable through the typed API — `include` is keyed by the
        // declared relations. Reachable from untyped callers, and a silent
        // skip there would look like "the relation is always empty".
        throw new AlephaError(
          `Unknown relation '${name}' on '${entityKey}'. Declared: ${
            declared ? Object.keys(declared).join(", ") || "(none)" : "(none)"
          }`,
        );
      }

      await this.resolveOne(ctx, name, relation, arg === true ? {} : arg);
    }
  }

  protected async resolveOne(
    ctx: ResolveContext,
    name: string,
    relation: ResolvedRelation,
    args: RelationRuntimeArgs,
  ): Promise<void> {
    const { rows, schema, map } = ctx;

    // Distinct, non-null join values. A null foreign key cannot match, and
    // including it would widen the IN list for nothing.
    const parentKeys = this.distinct(rows.map((row) => row[relation.from]));

    if (parentKeys.length === 0) {
      this.assignEmpty(rows, name, relation);
      return;
    }

    // For a many-to-many the junction decides which targets belong to which
    // parent, so it is fetched first and the target query keys off it.
    const bridge = relation.through
      ? await this.loadJunction(schema, relation, parentKeys)
      : undefined;

    if (bridge && bridge.targetKeys.length === 0) {
      this.assignEmpty(rows, name, relation);
      return;
    }

    // Columns the child rows must carry regardless of `select`:
    //  - `relation.to` groups them back to this parent;
    //  - the `from` column of each of the child's *own* includes, or the next
    //    level down has nothing to stitch on and silently resolves to
    //    undefined.
    const required = this.requiredColumns(relation, args, map);

    const children = await this.loadChildren({
      schema,
      relation,
      lookupKeys: bridge ? bridge.targetKeys : parentKeys,
      args,
      required,
      canPushLimit: parentKeys.length === 1 && !bridge,
    });

    // Recurse before stitching, so nested relations are already present on the
    // child objects the parent ends up holding.
    if (args.include && Object.keys(args.include).length > 0) {
      await this.resolve({
        rows: children,
        entityKey: relation.target,
        include: args.include,
        schema,
        map,
      });
    }

    this.stitch(rows, name, relation, children, args, bridge, required);
  }

  /**
   * Columns a child must return whatever `select` says, because the resolver
   * needs them to stitch. Dropped again before the row is handed back.
   */
  protected requiredColumns(
    relation: ResolvedRelation,
    args: RelationRuntimeArgs,
    map: RelationMapFor<any>,
  ): string[] {
    const required = new Set<string>([relation.to]);

    const declared = (map as any)[relation.target] as
      | Record<string, ResolvedRelation>
      | undefined;

    for (const name of Object.keys(args.include ?? {})) {
      if (!args.include?.[name]) continue;
      const from = declared?.[name]?.from;
      if (from) required.add(from);
    }

    return [...required];
  }

  /**
   * Fetch the junction rows for a many-to-many and index target -> parents.
   */
  protected async loadJunction(
    schema: EntitySchema,
    relation: ResolvedRelation,
    parentKeys: unknown[],
  ): Promise<Bridge> {
    const through = relation.through!;
    const repository = this.repositories.getRepository(
      this.entityOrThrow(schema, through.entity, relation),
    );

    const links = (await repository.findMany({
      where: { [through.fromColumn]: { inArray: parentKeys } } as any,
    })) as Array<Record<string, any>>;

    const parentByTarget = new Map<unknown, unknown[]>();
    for (const link of links) {
      const target = link[through.toColumn];
      if (target === null || target === undefined) continue;

      const bucket = parentByTarget.get(target);
      if (bucket) bucket.push(link[through.fromColumn]);
      else parentByTarget.set(target, [link[through.fromColumn]]);
    }

    this.log.debug(
      `Resolved junction '${through.entity}': ${links.length} link(s) in 1 query`,
    );

    return { parentByTarget, targetKeys: [...parentByTarget.keys()] };
  }

  protected async loadChildren(options: {
    schema: EntitySchema;
    relation: ResolvedRelation;
    lookupKeys: unknown[];
    args: RelationRuntimeArgs;
    required: string[];
    canPushLimit: boolean;
  }): Promise<Array<Record<string, any>>> {
    const { schema, relation, lookupKeys, args, required, canPushLimit } =
      options;

    const repository = this.repositories.getRepository(
      this.entityOrThrow(schema, relation.target, relation),
    );

    const match = { [relation.to]: { inArray: lookupKeys } };

    // A caller-supplied `where` narrows the batch rather than replacing the
    // key match, so a filter can never widen a relation to rows that do not
    // belong to the parent.
    const query: Record<string, unknown> = {
      where: args.where ? { and: [match, args.where] } : match,
    };

    if (args.orderBy !== undefined) query.orderBy = args.orderBy;

    if (args.select) {
      // The stitching columns must come back even when the caller did not ask
      // for them, or there is nothing to match on. Stripped again after.
      query.columns = this.distinct([...args.select, ...required]);
    }

    // `limit` is per parent. With a single parent the batch *is* that parent's
    // set, so it can be pushed into SQL; otherwise it is sliced in memory
    // after grouping, because one query cannot cap per group without window
    // functions.
    if (args.limit !== undefined && canPushLimit) query.limit = args.limit;

    const children = (await repository.findMany(query as any)) as Array<
      Record<string, any>
    >;

    this.log.debug(
      `Resolved '${relation.target}': ${children.length} row(s) for ${lookupKeys.length} key(s) in 1 query`,
    );

    return children;
  }

  protected stitch(
    rows: Array<Record<string, any>>,
    name: string,
    relation: ResolvedRelation,
    children: Array<Record<string, any>>,
    args: RelationRuntimeArgs,
    bridge: Bridge | undefined,
    required: string[],
  ): void {
    const byParent = new Map<unknown, Array<Record<string, any>>>();

    for (const child of children) {
      const childKey = child[relation.to];

      // Through a junction one child can belong to many parents; directly, to
      // exactly one.
      const parents = bridge
        ? (bridge.parentByTarget.get(childKey) ?? [])
        : [childKey];

      for (const parent of parents) {
        const bucket = byParent.get(parent);
        if (bucket) bucket.push(child);
        else byParent.set(parent, [child]);
      }
    }

    // Only now are the stitching columns expendable — drop the ones `select`
    // did not ask for, so the row matches the type the caller was handed.
    const hidden = args.select
      ? required.filter((column) => !args.select!.includes(column))
      : [];

    for (const row of rows) {
      let matched = byParent.get(row[relation.from]) ?? [];

      if (args.limit !== undefined && matched.length > args.limit) {
        matched = matched.slice(0, args.limit);
      }

      if (hidden.length > 0) {
        matched = matched.map((child) => {
          const copy = { ...child };
          for (const column of hidden) delete copy[column];
          return copy;
        });
      }

      row[name] = relation.kind === "many" ? matched : matched[0];
    }
  }

  protected assignEmpty(
    rows: Array<Record<string, any>>,
    name: string,
    relation: ResolvedRelation,
  ): void {
    for (const row of rows) {
      row[name] = relation.kind === "many" ? [] : undefined;
    }
  }

  protected entityOrThrow(
    schema: EntitySchema,
    key: string,
    relation: ResolvedRelation,
  ) {
    const entity = schema[key];
    if (!entity) {
      throw new AlephaError(
        `Relation to '${relation.target}' needs '${key}', which is not in the schema passed to $relations().`,
      );
    }
    return entity;
  }

  protected distinct<T>(values: T[]): T[] {
    return [
      ...new Set(
        values.filter((value) => value !== null && value !== undefined),
      ),
    ];
  }
}

export interface ResolveContext {
  rows: Array<Record<string, any>>;
  entityKey: string;
  include: Record<string, any>;
  schema: EntitySchema;
  map: RelationMapFor<any>;
}

interface Bridge {
  /** target key -> every parent that reaches it through the junction */
  parentByTarget: Map<unknown, unknown[]>;
  targetKeys: unknown[];
}

interface RelationRuntimeArgs {
  where?: unknown;
  orderBy?: unknown;
  limit?: number;
  select?: string[];
  include?: Record<string, any>;
}
