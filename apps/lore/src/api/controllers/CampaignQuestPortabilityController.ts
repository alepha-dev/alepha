import { $inject, AlephaError, t } from "alepha";
import { RealmProvider } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { campaigns } from "../entities/campaigns.ts";
import { chapters } from "../entities/chapters.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { importResultSchema } from "../schemas/questImportRow.ts";
import { QuestCsvFormatter } from "../services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "../services/QuestCsvParser.ts";
import { QuestImportFormatProvider } from "../services/QuestImportFormatProvider.ts";
import { QuestController } from "./QuestController.ts";

const EXPORT_LIMIT = 1000;

export class CampaignQuestPortabilityController {
  protected readonly quests = $repository(quests);
  protected readonly campaigns = $repository(campaigns);
  protected readonly chapters = $repository(chapters);
  protected readonly security = $inject(AppSecurityProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly formatter = $inject(QuestCsvFormatter);
  protected readonly parser = $inject(QuestCsvParser);
  protected readonly formats = $inject(QuestImportFormatProvider);
  protected readonly realm = $inject(RealmProvider);
  protected readonly quest = $inject(QuestController);

  exportQuests = $action({
    use: [$secure()],
    method: "GET",
    path: "/campaigns/:id/quests/export",
    schema: {
      params: t.object({ id: t.integer() }),
      response: t.file(),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const campaign = await this.campaigns.getOne({
        where: { id: { eq: params.id } },
      });
      const campaignQuests = await this.quests.findMany({
        where: { campaignId: { eq: params.id } },
        orderBy: "shortId",
        limit: EXPORT_LIMIT,
      });

      // Chapter title lookup (one round-trip).
      const chapterIds = [
        ...new Set(
          campaignQuests
            .map((q) => q.chapterId)
            .filter((id): id is number => typeof id === "number"),
        ),
      ];
      const chapterTitleById = new Map<number, string>();
      if (chapterIds.length > 0) {
        const rows = await this.chapters.findMany({
          where: { id: { inArray: chapterIds } },
        });
        for (const c of rows) chapterTitleById.set(c.id, c.title);
      }

      // User email lookup (one round-trip).
      const userIds = [
        ...new Set(
          campaignQuests.flatMap((q) =>
            [q.createdBy, q.acceptedBy, q.completedBy].filter(
              (v): v is string => typeof v === "string" && v.length > 0,
            ),
          ),
        ),
      ];
      const usersRepo = this.realm.userRepository();
      const userEmailById = new Map<string, string>();
      if (userIds.length > 0) {
        const rows = await usersRepo.findMany({
          where: { id: { inArray: userIds } },
        });
        for (const u of rows) {
          userEmailById.set(u.id, u.email ?? u.username ?? "");
        }
      }
      const emailFor = (id: string | undefined | null): string =>
        id ? (userEmailById.get(id) ?? "") : "";

      const status = (
        q: (typeof campaignQuests)[number],
      ): "new" | "accepted" | "completed" =>
        q.completedAt ? "completed" : q.acceptedAt ? "accepted" : "new";

      const text = this.formatter.format(
        campaignQuests.map((q) => ({
          shortId: q.shortId,
          title: q.title,
          status: status(q),
          priority: q.priority,
          difficulty: q.difficulty,
          zone: q.zone ?? "",
          kanbanColumn: q.kanbanColumn ?? "",
          chapter:
            q.chapterId != null
              ? (chapterTitleById.get(q.chapterId) ?? "")
              : "",
          createdBy: emailFor(q.createdBy),
          acceptedBy: emailFor(q.acceptedBy),
          completedBy: emailFor(q.completedBy),
          createdAt: q.createdAt ? new Date(q.createdAt).toISOString() : "",
          acceptedAt: q.acceptedAt ? new Date(q.acceptedAt).toISOString() : "",
          completedAt: q.completedAt
            ? new Date(q.completedAt).toISOString()
            : "",
          objectives: q.objectives ?? [],
          description: q.description ?? "",
        })),
      );

      const safeTitle = campaign.title.replace(/[^a-z0-9-]+/gi, "-");
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
    path: "/campaigns/:id/quests/import",
    schema: {
      params: t.object({ id: t.integer() }),
      body: t.object({ file: t.file() }),
      response: importResultSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.checkOwnership(params.id, user);

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

      // Existing quests in target campaign, indexed by shortId.
      const existing = await this.quests.findMany({
        where: { campaignId: { eq: params.id } },
        limit: 1000,
      });
      const existingByShortId = new Map<number, (typeof existing)[number]>();
      for (const q of existing) existingByShortId.set(q.shortId, q);

      // Chapters in this campaign, indexed by title.
      const chaptersInCampaign = await this.chapters.findMany({
        where: { campaignId: { eq: params.id } },
      });
      const chapterIdByTitle = new Map<string, number>();
      for (const c of chaptersInCampaign) chapterIdByTitle.set(c.title, c.id);

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

        // Resolve chapter title → id within this campaign.
        let chapterId: number | undefined;
        if (row.chapter) {
          chapterId = chapterIdByTitle.get(row.chapter);
          if (chapterId === undefined) {
            warnings.push({
              row: row.rowIndex,
              message: `Chapter '${row.chapter}' not found in campaign; left empty`,
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
          await this.quests.updateById(existingMatch.id, {
            title: row.title,
            description: row.description,
            zone: row.zone,
            priority: row.priority,
            difficulty: row.difficulty,
            kanbanColumn: row.kanbanColumn || undefined,
            chapterId,
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
              campaignId: params.id,
              title: row.title,
              description: row.description,
              zone: row.zone,
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
          chapterId !== undefined ||
          acceptedBy ||
          completedBy ||
          acceptedAt ||
          completedAt ||
          row.kanbanColumn;
        if (needsBackfill) {
          await this.quests.updateById(newQuest.id, {
            chapterId,
            acceptedBy,
            completedBy,
            acceptedAt,
            completedAt,
            kanbanColumn: row.kanbanColumn || undefined,
          });
        }
        created++;
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
