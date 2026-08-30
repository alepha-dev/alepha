import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import { relations } from "../relations.ts";
import { importResultSchema } from "../schemas/questImportRow.ts";
import { AreaService } from "../services/AreaService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestCsvFormatter } from "../services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "../services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "../services/QuestImportFormatProvider.ts";
import { QuestController } from "./QuestController.ts";

export class ProjectQuestPortabilityController {
  protected readonly EXPORT_LIMIT = 1000;

  protected readonly quests = $repository(quests);
  /**
   * ...with release and the three users a quest names, for the CSV export.
   */
  protected readonly questsWith = $repository(relations, "quests");
  protected readonly projects = $repository(projects);
  /**
   * ...with the account behind each membership row, so an import can
   * resolve an assignee email without reading the realm.
   */
  protected readonly membersWith = $repository(relations, "members");
  protected readonly releases = $repository(releases);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly formatter = $inject(QuestCsvFormatter);
  protected readonly parser = $inject(QuestCsvParser);
  protected readonly formats = $inject(QuestImportFormatProvider);
  protected readonly quest = $inject(QuestController);
  protected readonly areaService = $inject(AreaService);

  exportQuests = $action({
    // A permission, so the token carries a computed `ownership` for the
    // membership gate below (a bare `$secure()` leaves it undefined).
    use: [$secure({ permissions: ["quest:read"] })],
    method: "GET",
    path: "/projects/:id/quests/export",
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.file(),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.id, user);

      const project = await this.projects.getOne({
        where: { id: { eq: params.id } },
      });

      // Release title and the three people a quest names come back with the
      // quest itself, so the export is one statement instead of three.
      const projectQuests = await this.questsWith.findMany({
        where: { projectId: { eq: params.id } },
        orderBy: "shortId",
        limit: this.EXPORT_LIMIT,
        include: {
          release: { select: ["id", "tag"] },
          author: true,
          acceptedByUser: true,
          completedByUser: true,
        },
      });

      const emailOf = (u?: { email?: string; username?: string }): string =>
        u?.email ?? u?.username ?? "";

      const status = (
        q: (typeof projectQuests)[number],
      ): "new" | "accepted" | "completed" =>
        q.completedAt ? "completed" : q.acceptedAt ? "accepted" : "new";

      const text = this.formatter.format(
        projectQuests.map((q) => ({
          shortId: q.shortId,
          title: q.title,
          status: status(q),
          priority: q.priority,
          size: q.size,
          area: q.area ?? "",
          kanbanColumn: q.kanbanColumn ?? "",
          // The TAG, not the title: the tag is unique per project and is
          // what the import below matches on, so a round-trip through this
          // column has to carry the identity rather than a display name.
          release: q.releaseId != null ? (q.release?.tag ?? "") : "",
          createdBy: emailOf(q.author),
          acceptedBy: emailOf(q.acceptedByUser),
          completedBy: emailOf(q.completedByUser),
          createdAt: q.createdAt ? new Date(q.createdAt).toISOString() : "",
          acceptedAt: q.acceptedAt ? new Date(q.acceptedAt).toISOString() : "",
          completedAt: q.completedAt
            ? new Date(q.completedAt).toISOString()
            : "",
          objectives: q.objectives ?? [],
          description: q.description ?? "",
        })),
      );

      const safeTitle = project.title.replace(/[^a-z0-9-]+/gi, "-");
      const date = this.dt.nowISOString().split("T")[0];
      return this.fs.createFile({
        text,
        name: `quests-${safeTitle}-${date}.csv`,
        type: "text/csv",
      });
    },
  });

  importQuests = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:id/quests/import",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ file: z.file() }),
      response: importResultSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.id, user);

      const text = await body.file.text();
      const rows = this.parser.parse(text);
      if (rows.length === 0) {
        throw new BadRequestError("Empty CSV");
      }
      const header = rows[0];
      const format = this.formats.detect(header);
      if (!format) {
        throw new BadRequestError(
          "Unrecognized CSV format (expected Alepha Lore or Trello header).",
        );
      }
      const parser = this.formats.parser(format);

      // Existing quests in target project, indexed by shortId.
      const existing = await this.quests.findMany({
        where: { projectId: { eq: params.id } },
        limit: 1000,
      });
      const existingByShortId = new Map<number, (typeof existing)[number]>();
      for (const q of existing) existingByShortId.set(q.shortId, q);

      // Releases in this project, indexed by TAG. It used to be by title,
      // which is a display name two releases may share; the tag is unique
      // per project and is what the export writes.
      //
      // Published releases are indexed too, so the lookup can tell "no such
      // release" from "that release has shipped" and warn accordingly - a
      // silently-dropped attachment is the failure mode this whole import
      // path is careful about everywhere else.
      const releasesInProject = await this.releases.findMany({
        where: { projectId: { eq: params.id } },
      });
      const releaseByTag = new Map<
        string,
        (typeof releasesInProject)[number]
      >();
      for (const c of releasesInProject) {
        if (c.tag) releaseByTag.set(c.tag, c);
      }

      // The people this import may attribute a quest to: the project's own
      // members, and nobody else. Resolving against the whole realm made a
      // CSV upload an account-enumeration oracle (a row either warned or did
      // not, which answers "does this address have an account here"), and it
      // could assign a quest to a stranger who is not in the project and
      // cannot see it. One query for the whole file rather than one per
      // cell, which the realm-wide version needed.
      const projectMembers = await this.membersWith.findMany({
        where: { projectId: { eq: params.id } },
        include: { user: true },
      });
      const memberIdByLogin = new Map<string, string>();
      for (const member of projectMembers) {
        // A membership whose account is gone: the row outlives the user by
        // design, and there is nothing to attribute to.
        if (!member.user) continue;
        // Both, because the export writes `email ?? username`, so a member
        // with no address round-trips through the username column.
        for (const login of [member.user.email, member.user.username]) {
          if (login) memberIdByLogin.set(login.toLowerCase(), member.user.id);
        }
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; message: string }[] = [];
      const warnings: { row: number; message: string }[] = [];

      const resolveUser = (
        email: string,
        rowIndex: number,
        field: string,
      ): string | undefined => {
        if (!email) return undefined;
        const found = memberIdByLogin.get(email.trim().toLowerCase());
        if (!found) {
          // Deliberately says "not a member of this project" rather than
          // "not found": the warning is only ever read by someone who is
          // already a member, and it must not double as a directory lookup.
          warnings.push({
            row: rowIndex,
            message: `'${email}' is not a member of this project; ${field} left empty`,
          });
          return undefined;
        }
        return found;
      };

      const parseDate = (s: string): string | undefined =>
        s ? new Date(s).toISOString() : undefined;

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i];
        // Tolerate stray blank rows.
        if (cells.length === 1 && cells[0] === "") continue;

        const parsed = parser.parseRow(header, cells, i);
        if (!parsed.ok) {
          errors.push(parsed.error);
          skipped++;
          continue;
        }
        const row = parsed.row;

        // Every row from here down runs its own writes (area ensure, quest
        // create/update). Wrapped so a single bad row — e.g. an area name
        // over `areas.name`'s 48-char cap, rejected by `ensureArea` — is
        // reported and skipped instead of throwing out of the whole
        // request and discarding the created/updated counts (and the
        // already-committed writes) for every row processed so far.
        try {
          // Resolve release tag → id within this project.
          let releaseId: number | undefined;
          if (row.release) {
            const release = releaseByTag.get(row.release);
            if (!release) {
              warnings.push({
                row: row.rowIndex,
                message: `Release '${row.release}' not found in project; left empty`,
              });
            } else if (release.releasedAt) {
              // Not an error for the whole file: the row is imported, it
              // simply does not join a record that has already shipped.
              warnings.push({
                row: row.rowIndex,
                message: `Release '${row.release}' has been published and cannot take new quests; left empty`,
              });
            } else {
              releaseId = release.id;
            }
          }

          const acceptedBy = resolveUser(
            row.acceptedBy,
            row.rowIndex,
            "acceptedBy",
          );
          const completedBy = resolveUser(
            row.completedBy,
            row.rowIndex,
            "completedBy",
          );

          // Upsert path — only when shortId matches an existing quest.
          const existingMatch =
            row.writeMode === "upsert" && row.shortId
              ? existingByShortId.get(Number.parseInt(row.shortId, 10))
              : undefined;

          if (existingMatch) {
            // The `areas` table is the sole source of truth for the list.
            // `projects.areas` is `@deprecated` and nothing reads or writes
            // it. Guarded on a non-blank `row.area` the same way `area` is
            // guarded on `updateQuestById` — `ensureArea` already no-ops on
            // blank/whitespace, this just skips the call entirely for the
            // common case of a row with no area column at all.
            //
            // Store what `ensureArea` actually persisted, not `row.area`
            // directly — same reasoning as `QuestService.createQuest` and
            // `updateQuestById`: the quest must never point at a name that
            // doesn't match a row in `areas`.
            const ensuredArea = row.area
              ? await this.areaService.ensureArea(params.id, row.area)
              : undefined;

            await this.quests.updateById(existingMatch.id, {
              title: row.title,
              description: row.description,
              area: ensuredArea?.name ?? row.area,
              priority: row.priority,
              size: row.size,
              kanbanColumn: row.kanbanColumn || undefined,
              releaseId,
              acceptedBy,
              completedBy,
              acceptedAt: parseDate(row.acceptedAt),
              completedAt: parseDate(row.completedAt),
              objectives: row.objectives,
            });
            updated++;
            continue;
          }

          // Create path — reuse QuestController.createQuest so we get sequence
          // allocation, transactional wrapping, and history seeding. Then
          // patch the extras the create body doesn't accept.
          const createResponse = await this.quest.createQuest.fetch(
            {
              body: {
                projectId: params.id,
                title: row.title,
                description: row.description,
                area: row.area,
                priority: row.priority,
                size: row.size,
                objectives: row.objectives,
              },
            },
            { user },
          );
          const newQuest = createResponse.data;

          const acceptedAt = parseDate(row.acceptedAt);
          const completedAt = parseDate(row.completedAt);
          const needsBackfill =
            releaseId !== undefined ||
            acceptedBy ||
            completedBy ||
            acceptedAt ||
            completedAt ||
            row.kanbanColumn;
          if (needsBackfill) {
            await this.quests.updateById(newQuest.id, {
              releaseId,
              acceptedBy,
              completedBy,
              acceptedAt,
              completedAt,
              kanbanColumn: row.kanbanColumn || undefined,
            });
          }
          created++;
        } catch (error) {
          errors.push({
            row: row.rowIndex,
            message: error instanceof Error ? error.message : String(error),
          });
          skipped++;
        }
      }

      return {
        format,
        totalRows: rows.length - 1,
        created,
        updated,
        skipped,
        errors,
        warnings,
      };
    },
  });
}
