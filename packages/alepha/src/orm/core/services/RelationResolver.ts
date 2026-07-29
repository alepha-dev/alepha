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
 */
export class RelationResolver {
  protected readonly log = $logger();
  protected readonly repositories = $inject(RepositoryProvider);

  /**
   * Resolve `include` against `rows`, mutating each row to carry its
   * relations. Recurses for nested includes.
   */
  public async resolve(options: {
    rows: Array<Record<string, any>>;
    entityKey: string;
    include: Record<string, any>;
    schema: EntitySchema;
    map: RelationMapFor<any>;
  }): Promise<void> {
    const { rows, entityKey, include, schema, map } = options;

    if (rows.length === 0) return;

    const declared = (map as any)[entityKey] as
      | Record<string, ResolvedRelation>
      | undefined;

    for (const name of Object.keys(include)) {
      if (include[name] === undefined || include[name] === false) continue;

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

      await this.resolveOne({
        rows,
        name,
        relation,
        nested:
          typeof include[name] === "object" ? include[name].include : undefined,
        schema,
        map,
      });
    }
  }

  protected async resolveOne(options: {
    rows: Array<Record<string, any>>;
    name: string;
    relation: ResolvedRelation;
    nested?: Record<string, any>;
    schema: EntitySchema;
    map: RelationMapFor<any>;
  }): Promise<void> {
    const { rows, name, relation, nested, schema, map } = options;

    const targetEntity = schema[relation.target];
    if (!targetEntity) {
      throw new AlephaError(
        `Relation '${name}' targets '${relation.target}', which is not in the schema passed to $relations().`,
      );
    }

    // Distinct, non-null join values. A null foreign key cannot match, and
    // including it would widen the IN list for nothing.
    const keys = [
      ...new Set(
        rows
          .map((row) => row[relation.from])
          .filter((value) => value !== null && value !== undefined),
      ),
    ];

    if (keys.length === 0) {
      for (const row of rows) {
        row[name] = relation.kind === "many" ? [] : undefined;
      }
      return;
    }

    const repository = this.repositories.getRepository(targetEntity);
    const children = await repository.findMany({
      where: { [relation.to]: { inArray: keys } } as any,
      // `findMany` defaults to no limit, but a to-many relation can legitimately
      // return more rows than parents — make the intent explicit rather than
      // relying on that default staying put.
      limit: undefined,
    });

    // Recurse before stitching so nested relations are present on the child
    // objects the parent ends up holding.
    if (nested && Object.keys(nested).length > 0) {
      await this.resolve({
        rows: children as Array<Record<string, any>>,
        entityKey: relation.target,
        include: nested,
        schema,
        map,
      });
    }

    const grouped = new Map<unknown, Array<Record<string, any>>>();
    for (const child of children as Array<Record<string, any>>) {
      const key = child[relation.to];
      const bucket = grouped.get(key);
      if (bucket) bucket.push(child);
      else grouped.set(key, [child]);
    }

    for (const row of rows) {
      const matched = grouped.get(row[relation.from]) ?? [];
      row[name] = relation.kind === "many" ? matched : matched[0];
    }

    this.log.debug(
      `Resolved '${name}': ${children.length} row(s) for ${keys.length} key(s) in 1 query`,
    );
  }
}
