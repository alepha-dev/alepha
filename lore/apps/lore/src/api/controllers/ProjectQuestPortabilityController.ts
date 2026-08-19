import { $inject, AlephaError, z } from "alepha";
import { RealmProvider } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { milestones } from "../entities/milestones.ts";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { relations } from "../relations.ts";
import { importResultSchema } from "../schemas/questImportRow.ts";
import { AreaService } from "../services/AreaService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestCsvFormatter } from "../services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "../services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "../services/QuestImportFormatProvider.ts";
import { QuestController } from "./QuestController.ts";

const EXPORT_LIMIT = 1000;

export class ProjectQuestPortabilityController {
  protected readonly quests = $repository(quests);
  /** ...with milestone and the three users a quest names, for the CSV export. */
  protected readonly questsWith = $repository(relations, "quests");
  protected readonly projects = $repository(projects);
  protected readonly milestones = $repository(milestones);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly formatter = $inject(QuestCsvFormatter);
  protected readonly parser = $inject(QuestCsvParser);
  protected readonly formats = $inject(QuestImportFormatProvider);
  protected readonly realm = $inject(RealmProvider);
  protected readonly quest = $inject(QuestController);
  protected readonly areaService = $inject(AreaService);

  exportQuests = $action({
    use: [$secure()],
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

      // Milestone title and the three people a quest names come back with the
      // quest itself, so the export is one statement instead of three.
      const projectQuests = await this.questsWith.findMany({
        where: { projectId: { eq: params.id } },
        orderBy: "shortId",
        limit: EXPORT_LIMIT,
        include: {
          milestone: { select: ["id", "title"] },
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
          difficulty: q.difficulty,
          area: q.area ?? "",
          kanbanColumn: q.kanbanColumn ?? "",
          milestone: q.milestoneId != null ? (q.milestone?.title ?? "") : "",
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
    use: [$secure()],
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
        throw new AlephaError("Empty CSV");
      }
      const header = rows[0];
      const format = this.formats.detect(header);
      if (!format) {
        throw new AlephaError(
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

      // Milestones in this project, indexed by title.
      const milestonesInProject = await this.milestones.findMany({
        where: { projectId: { eq: params.id } },
      });
      const milestoneIdByTitle = new Map<string, number>();
      for (const c of milestonesInProject)
        milestoneIdByTitle.set(c.title, c.id);

      const usersRepo = this.realm.userRepository();

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; message: string }[] = [];
      const warnings: { row: number; message: string }[] = [];

      const resolveUser = async (
        email: string,
        rowIndex: number,
        field: string,
      ): Promise<string | undefined> => {
        if (!email) return undefined;
        const found = await usersRepo.findOne({
          where: { email: { eq: email } },
        });
        if (!found) {
          warnings.push({
            row: rowIndex,
            message: `User '${email}' not found for ${field}; left empty`,
          });
          return undefined;
        }
        return found.id;
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
          // Resolve milestone title → id within this project.
          let milestoneId: number | undefined;
          if (row.milestone) {
            milestoneId = milestoneIdByTitle.get(row.milestone);
            if (milestoneId === undefined) {
              warnings.push({
                row: row.rowIndex,
                message: `Milestone '${row.milestone}' not found in project; left empty`,
              });
            }
          }

          const acceptedBy = await resolveUser(
            row.acceptedBy,
            row.rowIndex,
            "acceptedBy",
          );
          const completedBy = await resolveUser(
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
              difficulty: row.difficulty,
              kanbanColumn: row.kanbanColumn || undefined,
              milestoneId,
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
          // allocation, HTML sanitization, transactional wrapping, and history
          // seeding. Then patch the extras the create body doesn't accept.
          const createResponse = await this.quest.createQuest.fetch(
            {
              body: {
                projectId: params.id,
                title: row.title,
                description: row.description,
                area: row.area,
                priority: row.priority,
                difficulty: row.difficulty,
                objectives: row.objectives,
              },
            },
            { user },
          );
          const newQuest = createResponse.data;

          const acceptedAt = parseDate(row.acceptedAt);
          const completedAt = parseDate(row.completedAt);
          const needsBackfill =
            milestoneId !== undefined ||
            acceptedBy ||
            completedBy ||
            acceptedAt ||
            completedAt ||
            row.kanbanColumn;
          if (needsBackfill) {
            await this.quests.updateById(newQuest.id, {
              milestoneId,
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
