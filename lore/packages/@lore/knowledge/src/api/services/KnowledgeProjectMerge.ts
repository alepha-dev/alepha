import {
  type ProjectMergeChange,
  type ProjectMergeContext,
  ProjectMergeNumbers,
  type ProjectMergeRenumber,
  type ProjectMergeRewriter,
  ProjectMergeService,
  type ProjectMergeStepPlan,
} from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { DatabaseProvider, sql, type SQLLike } from "alepha/orm";

import { pinnedContentAtom } from "../atoms/pinnedContentAtom.ts";
import { buildFolioSearchText } from "../entities/folios.ts";

/**
 * Knowledge's step of a project merge, registered on core's
 * `ProjectMergeService` (#E94, #Q2781): folios, their directories and their
 * attachments move into the target project.
 *
 * - Each of the three carries its own per-project short id (`#F12`, the
 *   directory and attachment ids), renumbered on a collision by
 *   `ProjectMergeNumbers`. Revisions follow their folio by its global id.
 * - **Root names.** `folio_names` reserves every name per parent, and a
 *   ROOT entry is keyed by the project (`root:<projectId>`). A source root
 *   folio or directory whose name the target root already holds gets the
 *   suffix `FolioNameService.autoSuffix` would give it (`Name (1)`), title
 *   and search text included, and its reservation moves to the target's
 *   root key. Names inside a directory are keyed by the directory, which
 *   moves whole, so they cannot clash.
 * - **Pins.** `project_context` folds pinned folio bodies under one
 *   character budget (`pinnedContentAtom`). The target's pins stay; a
 *   source pin stays pinned only while the sum fits, newest first, and is
 *   unpinned otherwise, so the target's own rules are not pushed out of
 *   its agents' orientation. A protected folio is never folded, so its pin
 *   costs nothing and stays.
 */
export class KnowledgeProjectMerge {
  protected readonly alepha = $inject(Alepha);
  protected readonly merge = $inject(ProjectMergeService);
  protected readonly numbers = $inject(ProjectMergeNumbers);
  protected readonly database = $inject(DatabaseProvider);

  constructor() {
    this.merge.registerStep({
      order: 20,
      name: "knowledge",
      tables: ["folios", "folio_directories", "folio_blobs"],
      plan: (context) => this.plan(context),
      rewrite: (context, rewriter, plan) =>
        this.rewrite(context, rewriter, plan.changed),
    });
  }

  /**
   * Folio bodies and summaries, outside the protected ones: their content
   * is ciphertext the server cannot read, let alone rewrite. The search
   * text is rebuilt with the folio's final title, which the name check may
   * have just suffixed.
   */
  protected async rewrite(
    context: ProjectMergeContext,
    rewriter: ProjectMergeRewriter,
    changed: ProjectMergeChange[],
  ): Promise<{ rewritten: Record<string, number>; statements: SQLLike[] }> {
    const titles = new Map(
      changed
        .filter((change) => change.kind === "folio" && change.field === "title")
        .map((change) => [String(change.id), change.to]),
    );
    const rows = await this.database.execute(
      sql`SELECT id, title, summary, content FROM folios WHERE project_id = ${context.sourceProjectId} AND protected = ${this.flag(false)}`,
    );
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const statements: SQLLike[] = [];
    for (const row of rows) {
      const id = text(row.id);
      const summary = text(row.summary);
      const content = text(row.content);
      const nextSummary = rewriter.text(summary);
      const nextContent = rewriter.text(content);
      if (nextSummary === summary && nextContent === content) {
        continue;
      }
      const searchText = buildFolioSearchText({
        title: titles.get(id) ?? text(row.title),
        summary: nextSummary,
        content: nextContent,
      });
      statements.push(
        sql`UPDATE folios SET summary = ${nextSummary}, content = ${nextContent}, search_text = ${searchText} WHERE id = ${id}`,
      );
    }
    return { rewritten: { folios: statements.length }, statements };
  }

  /**
   * The tables that move whole and carry a per-project short id.
   */
  protected static readonly numbered: NumberedTable[] = [
    {
      kind: "folio",
      table: "folios",
      idColumn: "id",
      sequence: "folioShortId",
    },
    {
      kind: "directory",
      table: "folio_directories",
      idColumn: "id",
      sequence: "directoryShortId",
    },
    {
      kind: "attachment",
      table: "folio_blobs",
      idColumn: "file_id",
      sequence: "blobShortId",
    },
  ];

  protected async plan(
    context: ProjectMergeContext,
  ): Promise<Omit<ProjectMergeStepPlan, "name">> {
    const moved: Record<string, number> = {};
    const renumbered: ProjectMergeRenumber[] = [];
    const changed: ProjectMergeChange[] = [];
    const statements: SQLLike[] = [];

    // Names and pins first: their statements touch rows by id, so the
    // order against the moves below does not matter, but reading them
    // before anything else keeps the plan a pure function of the start.
    const names = await this.planRootNames(context);
    changed.push(...names.changed);
    statements.push(...names.statements);

    const pins = await this.planPins(context);
    changed.push(...pins.changed);
    statements.push(...pins.statements);

    for (const table of KnowledgeProjectMerge.numbered) {
      const source = await this.rows(table, context.sourceProjectId);
      const target = await this.rows(table, context.targetProjectId);
      const numbering = await this.numbers.renumber({
        kind: table.kind,
        table: table.table,
        column: "short_id",
        idColumn: table.idColumn,
        sequence: table.sequence,
        targetProjectId: context.targetProjectId,
        targetNumbers: target.map((row) => row.number),
        sourceRows: source,
      });
      moved[table.table] = source.length;
      renumbered.push(...numbering.renumbered);
      statements.push(
        ...numbering.statements,
        sql`UPDATE ${sql.identifier(table.table)} SET project_id = ${context.targetProjectId} WHERE project_id = ${context.sourceProjectId}`,
      );
    }

    statements.push(
      sql`UPDATE folio_names SET parent_directory_id = ${`root:${context.targetProjectId}`}, root_scope = ${String(context.targetProjectId)} WHERE parent_directory_id = ${`root:${context.sourceProjectId}`}`,
    );

    return { moved, renumbered, joined: [], changed, statements };
  }

  /**
   * Suffixes every source root entry whose name the target root holds.
   * Taken names are read from both the reservations and the rows: a row
   * written before reservations existed has none, and is still a name the
   * tree shows.
   */
  protected async planRootNames(context: ProjectMergeContext): Promise<{
    changed: ProjectMergeChange[];
    statements: SQLLike[];
  }> {
    const reserved = await this.database.execute(
      sql`SELECT lower_name FROM folio_names WHERE parent_directory_id = ${`root:${context.targetProjectId}`}`,
    );
    const taken = new Set(
      [
        ...reserved.map((row) =>
          typeof row.lower_name === "string" ? row.lower_name : "",
        ),
        ...(await this.rootEntries(context.targetProjectId)).map(
          (entry) => entry.name,
        ),
      ].map((name) => name.trim().toLowerCase()),
    );

    const changed: ProjectMergeChange[] = [];
    const statements: SQLLike[] = [];
    for (const entry of await this.rootEntries(context.sourceProjectId)) {
      const name = entry.name;
      if (!taken.has(name.trim().toLowerCase())) {
        taken.add(name.trim().toLowerCase());
        continue;
      }
      const renamed = this.suffix(name, taken);
      taken.add(renamed.trim().toLowerCase());
      const id = entry.id;
      changed.push({
        kind: entry.kind,
        id,
        field: entry.kind === "folio" ? "title" : "name",
        from: name,
        to: renamed,
      });
      if (entry.kind === "folio") {
        const searchText = entry.protected
          ? ""
          : buildFolioSearchText({
              title: renamed,
              summary: entry.summary,
              content: entry.content,
            });
        statements.push(
          sql`UPDATE folios SET title = ${renamed}, search_text = ${searchText} WHERE id = ${id}`,
        );
      } else {
        statements.push(
          sql`UPDATE folio_directories SET name = ${renamed} WHERE id = ${id}`,
        );
      }
      statements.push(
        sql`UPDATE folio_names SET lower_name = ${renamed.trim().toLowerCase()} WHERE entity_id = ${id}`,
      );
    }
    return { changed, statements };
  }

  /**
   * A project's root folios and directories, oldest first.
   */
  protected async rootEntries(projectId: number): Promise<RootEntry[]> {
    const folios = await this.database.execute(
      sql`SELECT 'folio' AS kind, id, title AS name, summary, content, protected FROM folios WHERE project_id = ${projectId} AND directory_id IS NULL ORDER BY created_at, id`,
    );
    const directories = await this.database.execute(
      sql`SELECT 'directory' AS kind, id, name FROM folio_directories WHERE project_id = ${projectId} AND parent_id IS NULL ORDER BY created_at, id`,
    );
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return [...directories, ...folios].map((row) => ({
      kind: row.kind === "folio" ? "folio" : "directory",
      id: text(row.id),
      name: text(row.name),
      summary: text(row.summary),
      content: text(row.content),
      protected: row.protected === true || Number(row.protected) === 1,
    }));
  }

  /**
   * The first free `Name (n)`, with the extension kept last, as
   * `FolioNameService.autoSuffix` forms it.
   */
  protected suffix(name: string, taken: Set<string>): string {
    const trimmed = name.trim();
    const dot = trimmed.startsWith(".") ? -1 : trimmed.lastIndexOf(".");
    const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
    const ext = dot > 0 ? trimmed.slice(dot) : "";
    for (let n = 1; ; n += 1) {
      const candidate = `${stem} (${n})${ext}`;
      if (!taken.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }

  protected async planPins(context: ProjectMergeContext): Promise<{
    changed: ProjectMergeChange[];
    statements: SQLLike[];
  }> {
    const pinned = async (projectId: number) =>
      (
        await this.database.execute(
          sql`SELECT id, title, length(content) AS size, protected FROM folios WHERE project_id = ${projectId} AND pinned = ${this.flag(true)} ORDER BY updated_at DESC, id`,
        )
      ).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        size: Number(row.size ?? 0),
        isProtected: row.protected === true || Number(row.protected) === 1,
      }));
    const budget = this.alepha.store.get(pinnedContentAtom).maxChars;
    let used = (await pinned(context.targetProjectId))
      .filter((folio) => !folio.isProtected)
      .reduce((sum, folio) => sum + folio.size, 0);

    const changed: ProjectMergeChange[] = [];
    const statements: SQLLike[] = [];
    for (const folio of await pinned(context.sourceProjectId)) {
      if (folio.isProtected || used + folio.size <= budget) {
        used += folio.isProtected ? 0 : folio.size;
        continue;
      }
      changed.push({
        kind: "folio",
        id: folio.id,
        field: "pinned",
        from: "true",
        to: "false",
      });
      statements.push(
        sql`UPDATE folios SET pinned = ${this.flag(false)} WHERE id = ${folio.id}`,
      );
    }
    return { changed, statements };
  }

  /**
   * A boolean as the driver binds it: SQLite stores 0 and 1.
   */
  protected flag(value: boolean): boolean | number {
    if (this.database.dialect === "sqlite") {
      return value ? 1 : 0;
    }
    return value;
  }

  /**
   * Every row of a project, in creation order.
   */
  protected async rows(
    table: NumberedTable,
    projectId: number,
  ): Promise<Array<{ id: string; number: number }>> {
    const rows = await this.database.execute(
      sql`SELECT ${sql.identifier(table.idColumn)} AS id, short_id FROM ${sql.identifier(table.table)} WHERE project_id = ${projectId} ORDER BY created_at, ${sql.identifier(table.idColumn)}`,
    );
    return rows.map((row) => ({
      id: String(row.id),
      number: Number(row.short_id),
    }));
  }
}

/**
 * A folio or directory at a project's root, as the name check reads it.
 */
interface RootEntry {
  kind: "folio" | "directory";
  id: string;
  name: string;
  summary: string;
  content: string;
  protected: boolean;
}

/**
 * A Knowledge table that moves whole and carries a per-project short id.
 */
interface NumberedTable {
  kind: string;
  table: string;
  idColumn: string;
  sequence: string;
}
