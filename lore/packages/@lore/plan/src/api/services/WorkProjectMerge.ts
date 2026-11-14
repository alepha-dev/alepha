import {
  type ProjectMergeContext,
  type ProjectMergeJoin,
  ProjectMergeNumbers,
  ProjectMergeReferences,
  type ProjectMergeRenumber,
  type ProjectMergeRewriter,
  type ProjectMergeSequence,
  ProjectMergeService,
  type ProjectMergeStepPlan,
  projectMergeWrite,
} from "@lore/core/api";
import { $inject, type ZObject } from "alepha";
import {
  $repository,
  type EntityPrimitive,
  type PgQueryWhere,
  type Repository,
  RepositoryProvider,
  type SQLLike,
} from "alepha/orm";

import { areas } from "../entities/areas.ts";
import { epicReviewItems } from "../entities/epicReviewItems.ts";
import { epicReviews } from "../entities/epicReviews.ts";
import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { feedbackComments } from "../entities/feedbackComments.ts";
import { questComments } from "../entities/questComments.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";

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
 * Every read passes `force`: soft-deleted rows still occupy the unique
 * indexes the move must not trip, and move with the rest. The writes are
 * raw statements of the merge's one atomic batch.
 */
export class WorkProjectMerge {
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly numbers = $inject(ProjectMergeNumbers);
  protected readonly references = $inject(ProjectMergeReferences);
  protected readonly repositories = $inject(RepositoryProvider);
  protected readonly quests = $repository(quests);
  protected readonly questComments = $repository(questComments);
  protected readonly epics = $repository(epics);
  protected readonly epicReviews = $repository(epicReviews);
  protected readonly epicReviewItems = $repository(epicReviewItems);
  protected readonly feedback = $repository(feedback);
  protected readonly feedbackComments = $repository(feedbackComments);
  protected readonly releases = $repository(releases);
  protected readonly areas = $repository(areas);

  constructor() {
    this.merge.registerStep({
      order: 10,
      name: "work",
      tables: [
        "quests",
        "epics",
        "epic_reviews",
        "feedback",
        "releases",
        "areas",
      ],
      plan: (context) => this.plan(context),
      rewrite: (context, rewriter) => this.rewrite(context, rewriter),
    });
  }

  /**
   * Every Work text that can hold a reference: quest bodies and completion
   * summaries, their comments, epic descriptions, feedback and its
   * comments, release notes. Read by the source's ids, which is what they
   * still are while the plan is read.
   */
  protected async rewrite(
    context: ProjectMergeContext,
    rewriter: ProjectMergeRewriter,
  ): Promise<{ rewritten: Record<string, number>; statements: SQLLike[] }> {
    const source = context.sourceProjectId;
    const force = { force: true };
    const rewritten: Record<string, number> = {};
    const statements: SQLLike[] = [];
    const rewrite = async <T extends ZObject>(
      repository: Repository<T>,
      fields: string[],
      where: PgQueryWhere<T>,
    ) => {
      const result = await this.references.rewrite(rewriter, {
        repository,
        fields,
        where,
      });
      rewritten[repository.tableName] = result.rewritten;
      statements.push(...result.statements);
    };
    await rewrite(this.quests, ["description", "completionMessage"], {
      projectId: { eq: source },
    });
    await rewrite(this.questComments, ["body"], {
      questId: {
        inArray: this.quests.subquery(
          { projectId: { eq: source } },
          "id",
          force,
        ),
      },
    });
    await rewrite(this.epics, ["description"], { projectId: { eq: source } });
    await rewrite(this.epicReviews, ["summary"], {
      projectId: { eq: source },
    });
    // A change item's `target` is a JSON number and is not rewritten: a
    // renumbered quest leaves it naming the old number, as a record.
    await rewrite(this.epicReviewItems, ["title", "context", "answer"], {
      epicId: {
        inArray: this.epics.subquery(
          { projectId: { eq: source } },
          "id",
          force,
        ),
      },
    });
    await rewrite(this.feedback, ["description"], {
      projectId: { eq: source },
    });
    await rewrite(this.feedbackComments, ["body"], {
      feedbackId: {
        inArray: this.feedback.subquery(
          { projectId: { eq: source } },
          "id",
          force,
        ),
      },
    });
    await rewrite(this.releases, ["description", "changelog"], {
      projectId: { eq: source },
    });
    return { rewritten, statements };
  }

  protected async plan(
    context: ProjectMergeContext,
  ): Promise<Omit<ProjectMergeStepPlan, "name">> {
    const renumbered: ProjectMergeRenumber[] = [];
    const joined: ProjectMergeJoin[] = [];
    const statements: SQLLike[] = [];
    const sequences: ProjectMergeSequence[] = [];
    const moved: Record<string, number> = {};

    for (const kind of WorkProjectMerge.numbered) {
      const result = await this.planNumbered(context, kind);
      renumbered.push(...result.renumbered);
      statements.push(...result.statements);
      sequences.push(...result.sequences);
      moved[kind.entity.name] = result.moved;
    }

    // An epic's reviews carry its project too (#E121), and move with it.
    // Their items name the epic alone, and the epic keeps its id.
    statements.push(this.move(this.epicReviews, context));
    moved.epic_reviews = await this.epicReviews.count(
      { projectId: { eq: context.sourceProjectId } },
      { force: true },
    );

    const releases = await this.planReleases(context);
    renumbered.push(...releases.renumbered);
    joined.push(...releases.joined);
    statements.push(...releases.statements);
    sequences.push(...releases.sequences);
    moved.releases = releases.moved;

    const areas = await this.planAreas(context);
    joined.push(...areas.joined);
    statements.push(...areas.statements);
    moved.areas = areas.moved;

    return { moved, renumbered, joined, changed: [], statements, sequences };
  }

  /**
   * The kinds that move whole and carry a per-project number.
   */
  protected static readonly numbered: NumberedKind[] = [
    {
      kind: "quest",
      entity: quests,
      field: "shortId",
      sequence: "questShortId",
    },
    { kind: "epic", entity: epics, field: "number", sequence: "epicNumber" },
    {
      kind: "feedback",
      entity: feedback,
      field: "shortId",
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
    sequences: ProjectMergeSequence[];
  }> {
    const repository = this.repositories.getRepository(kind.entity);
    const source = await this.rows(
      repository,
      kind.field,
      context.sourceProjectId,
    );
    const target = await this.rows(
      repository,
      kind.field,
      context.targetProjectId,
    );
    const numbering = await this.numbers.renumber({
      kind: kind.kind,
      repository,
      field: kind.field,
      sequence: kind.sequence,
      targetProjectId: context.targetProjectId,
      targetNumbers: target.map((row) => row.number),
      sourceRows: source,
    });
    return {
      moved: source.length,
      renumbered: numbering.renumbered,
      sequences: numbering.sequences,
      statements: [
        // Renumbered while still in the source project, where the new
        // number is free too: it is above every number the source uses.
        ...numbering.statements,
        this.move(repository, context),
      ],
    };
  }

  protected async planReleases(context: ProjectMergeContext): Promise<{
    moved: number;
    renumbered: ProjectMergeRenumber[];
    joined: ProjectMergeJoin[];
    statements: SQLLike[];
    sequences: ProjectMergeSequence[];
  }> {
    const read = async (projectId: number) =>
      (
        await this.releases.findMany(
          {
            where: { projectId: { eq: projectId } },
            columns: ["id", "number", "tag", "defaultSince"],
            orderBy: [{ column: "id", direction: "asc" }],
          },
          { force: true },
        )
      ).map((row) => ({
        id: row.id,
        number: row.number,
        tag: row.tag ?? undefined,
        isDefault: row.defaultSince != null,
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
        this.quests.updateStatement(
          { releaseId: { eq: row.id } },
          { releaseId: match.id },
          projectMergeWrite,
        ),
        this.epics.updateStatement(
          { releaseId: { eq: row.id } },
          { releaseId: match.id },
          projectMergeWrite,
        ),
        this.releases.deleteStatement({ id: { eq: row.id } }, { force: true }),
      );
    }
    // One default per project: the target's stays when it has one.
    if (target.some((row) => row.isDefault)) {
      for (const row of moving.filter((row) => row.isDefault)) {
        statements.push(
          this.releases.updateStatement(
            { id: { eq: row.id } },
            { defaultSince: null },
            projectMergeWrite,
          ),
        );
      }
    }
    const numbering = await this.numbers.renumber({
      kind: "release",
      repository: this.releases,
      field: "number",
      sequence: "releaseNumber",
      targetProjectId: context.targetProjectId,
      targetNumbers: target.map((row) => row.number),
      sourceRows: moving,
    });
    statements.push(...numbering.statements, this.move(this.releases, context));
    return {
      moved: moving.length,
      renumbered: numbering.renumbered,
      joined,
      statements,
      sequences: numbering.sequences,
    };
  }

  protected async planAreas(context: ProjectMergeContext): Promise<{
    moved: number;
    joined: ProjectMergeJoin[];
    statements: SQLLike[];
  }> {
    const read = async (projectId: number) =>
      (
        await this.areas.findMany(
          {
            where: { projectId: { eq: projectId } },
            columns: ["id", "name", "deletedAt"],
            orderBy: [{ column: "id", direction: "asc" }],
          },
          { force: true },
        )
      ).map((row) => ({
        id: row.id,
        name: row.name,
        live: row.deletedAt == null,
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
          this.areas.updateStatement(
            { id: { eq: match.id } },
            { deletedAt: null },
            projectMergeWrite,
          ),
        );
      }
      statements.push(
        this.areas.deleteStatement({ id: { eq: row.id } }, { force: true }),
      );
    }
    statements.push(this.move(this.areas, context));
    return { moved: source.length - joined.length, joined, statements };
  }

  /**
   * Every row of a project, soft-deleted ones included, in creation order.
   */
  protected async rows(
    repository: Repository<ZObject>,
    field: string,
    projectId: number,
  ): Promise<Array<{ id: number; number: number }>> {
    const rows = (await repository.findMany(
      {
        where: { projectId: { eq: projectId } },
        columns: ["id", field],
        orderBy: [{ column: "id", direction: "asc" }],
      } as never,
      { force: true },
    )) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id),
      number: Number(row[field]),
    }));
  }

  /**
   * Every row of the source, soft-deleted ones included, into the target.
   */
  protected move(
    repository: Repository<ZObject>,
    context: ProjectMergeContext,
  ): SQLLike {
    return repository.updateStatement(
      { projectId: { eq: context.sourceProjectId } } as never,
      { projectId: context.targetProjectId } as never,
      projectMergeWrite,
    );
  }
}

/**
 * A Work table that moves whole and carries a per-project number.
 */
interface NumberedKind {
  kind: string;
  entity: EntityPrimitive<any>;
  /**
   * The field holding the per-project number.
   */
  field: string;
  sequence: string;
}
