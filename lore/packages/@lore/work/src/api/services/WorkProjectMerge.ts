import {
  type ProjectMergeContext,
  type ProjectMergeJoin,
  ProjectMergeNumbers,
  type ProjectMergeRenumber,
  ProjectMergeService,
  type ProjectMergeStepPlan,
} from "@lore/core/api";
import { $inject } from "alepha";
import { DatabaseProvider, sql, type SQLLike } from "alepha/orm";

/**
 * Work's step of a project merge, registered on core's `ProjectMergeService`
 * (#E94, #Q2780): quests, epics, feedback, releases and areas move into the
 * target project.
 *
 * - Quests, epics and feedback move whole; a short id or epic number taken
 *   in the target is renumbered (`ProjectMergeNumbers`).
 * - A release whose TAG the target already has is joined to the target's:
 *   its quests and epics point at the target's release, and the source row
 *   goes. `(project_id, tag)` is unique, and two `0.33.0` in one project is
 *   not a state the release page can show. Any other release moves, its
 *   number renumbered on a collision, and loses its default mark when the
 *   target has a default of its own.
 * - An area whose NAME the target already has is joined the same way:
 *   `quests.area` is a name, so nothing needs re-pointing, and a target row
 *   soft-deleted while the source's is live is brought back, since every
 *   area a quest names has a live row.
 *
 * Every read is raw SQL on purpose: soft-deleted rows still occupy the
 * unique indexes the move must not trip, and the repositories hide them.
 */
export class WorkProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly numbers = $inject(ProjectMergeNumbers);
  protected readonly database = $inject(DatabaseProvider);

  constructor() {
    this.merge.registerStep({
      order: 10,
      name: "work",
      plan: (context) => this.plan(context),
    });
  }

  protected async plan(
    context: ProjectMergeContext,
  ): Promise<Omit<ProjectMergeStepPlan, "name">> {
    const renumbered: ProjectMergeRenumber[] = [];
    const joined: ProjectMergeJoin[] = [];
    const statements: SQLLike[] = [];
    const moved: Record<string, number> = {};

    for (const kind of WorkProjectMerge.numbered) {
      const result = await this.planNumbered(context, kind);
      renumbered.push(...result.renumbered);
      statements.push(...result.statements);
      moved[kind.table] = result.moved;
    }

    const releases = await this.planReleases(context);
    renumbered.push(...releases.renumbered);
    joined.push(...releases.joined);
    statements.push(...releases.statements);
    moved.releases = releases.moved;

    const areas = await this.planAreas(context);
    joined.push(...areas.joined);
    statements.push(...areas.statements);
    moved.areas = areas.moved;

    return { moved, renumbered, joined, statements };
  }

  /**
   * The kinds that move whole and carry a per-project number.
   */
  protected static readonly numbered: NumberedKind[] = [
    {
      kind: "quest",
      table: "quests",
      column: "short_id",
      sequence: "questShortId",
    },
    { kind: "epic", table: "epics", column: "number", sequence: "epicNumber" },
    {
      kind: "feedback",
      table: "feedback",
      column: "short_id",
      sequence: "feedbackShortId",
    },
  ];

  protected async planNumbered(
    context: ProjectMergeContext,
    kind: NumberedKind,
  ): Promise<{
    moved: number;
    renumbered: ProjectMergeRenumber[];
    statements: SQLLike[];
  }> {
    const source = await this.rows(
      kind.table,
      kind.column,
      context.sourceProjectId,
    );
    const target = await this.rows(
      kind.table,
      kind.column,
      context.targetProjectId,
    );
    const numbering = await this.numbers.renumber({
      kind: kind.kind,
      table: kind.table,
      column: kind.column,
      sequence: kind.sequence,
      targetProjectId: context.targetProjectId,
      targetNumbers: target.map((row) => row.number),
      sourceRows: source,
    });
    return {
      moved: source.length,
      renumbered: numbering.renumbered,
      statements: [
        // Renumbered while still in the source project, where the new
        // number is free too: it is above every number the source uses.
        ...numbering.statements,
        this.move(kind.table, context),
      ],
    };
  }

  protected async planReleases(context: ProjectMergeContext): Promise<{
    moved: number;
    renumbered: ProjectMergeRenumber[];
    joined: ProjectMergeJoin[];
    statements: SQLLike[];
  }> {
    const read = async (projectId: number) =>
      (
        await this.database.execute(
          sql`SELECT id, number, tag, default_since FROM releases WHERE project_id = ${projectId} ORDER BY id`,
        )
      ).map((row) => ({
        id: Number(row.id),
        number: Number(row.number),
        tag: typeof row.tag === "string" ? row.tag : undefined,
        isDefault: row.default_since != null,
      }));
    const source = await read(context.sourceProjectId);
    const target = await read(context.targetProjectId);
    const byTag = new Map(
      target.filter((row) => row.tag).map((row) => [row.tag, row]),
    );

    const joined: ProjectMergeJoin[] = [];
    const statements: SQLLike[] = [];
    const moving = source.filter((row) => !row.tag || !byTag.has(row.tag));
    for (const row of source) {
      const match = row.tag ? byTag.get(row.tag) : undefined;
      if (!match) {
        continue;
      }
      joined.push({
        kind: "release",
        key: row.tag!,
        sourceId: row.id,
        targetId: match.id,
      });
      statements.push(
        sql`UPDATE quests SET release_id = ${match.id} WHERE release_id = ${row.id}`,
        sql`UPDATE epics SET release_id = ${match.id} WHERE release_id = ${row.id}`,
        sql`DELETE FROM releases WHERE id = ${row.id}`,
      );
    }
    // One default per project: the target's stays when it has one.
    if (target.some((row) => row.isDefault)) {
      for (const row of moving.filter((row) => row.isDefault)) {
        statements.push(
          sql`UPDATE releases SET default_since = NULL WHERE id = ${row.id}`,
        );
      }
    }
    const numbering = await this.numbers.renumber({
      kind: "release",
      table: "releases",
      column: "number",
      sequence: "releaseNumber",
      targetProjectId: context.targetProjectId,
      targetNumbers: target.map((row) => row.number),
      sourceRows: moving,
    });
    statements.push(...numbering.statements, this.move("releases", context));
    return {
      moved: moving.length,
      renumbered: numbering.renumbered,
      joined,
      statements,
    };
  }

  protected async planAreas(context: ProjectMergeContext): Promise<{
    moved: number;
    joined: ProjectMergeJoin[];
    statements: SQLLike[];
  }> {
    const read = async (projectId: number) =>
      (
        await this.database.execute(
          sql`SELECT id, name, deleted_at FROM areas WHERE project_id = ${projectId} ORDER BY id`,
        )
      ).map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        live: row.deleted_at == null,
      }));
    const source = await read(context.sourceProjectId);
    const byName = new Map(
      (await read(context.targetProjectId)).map((row) => [row.name, row]),
    );

    const joined: ProjectMergeJoin[] = [];
    const statements: SQLLike[] = [];
    for (const row of source) {
      const match = byName.get(row.name);
      if (!match) {
        continue;
      }
      joined.push({
        kind: "area",
        key: row.name,
        sourceId: row.id,
        targetId: match.id,
      });
      if (row.live && !match.live) {
        statements.push(
          sql`UPDATE areas SET deleted_at = NULL WHERE id = ${match.id}`,
        );
      }
      statements.push(sql`DELETE FROM areas WHERE id = ${row.id}`);
    }
    statements.push(this.move("areas", context));
    return { moved: source.length - joined.length, joined, statements };
  }

  /**
   * Every row of a project, soft-deleted ones included, in creation order.
   */
  protected async rows(
    table: string,
    column: string,
    projectId: number,
  ): Promise<Array<{ id: number; number: number }>> {
    const rows = await this.database.execute(
      sql`SELECT id, ${sql.identifier(column)} AS number FROM ${sql.identifier(table)} WHERE project_id = ${projectId} ORDER BY id`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      number: Number(row.number),
    }));
  }

  protected move(table: string, context: ProjectMergeContext): SQLLike {
    return sql`UPDATE ${sql.identifier(table)} SET project_id = ${context.targetProjectId} WHERE project_id = ${context.sourceProjectId}`;
  }
}

/**
 * A Work table that moves whole and carries a per-project number.
 */
interface NumberedKind {
  kind: string;
  table: string;
  column: string;
  sequence: string;
}
