import {
  BoundParameters,
  ResourceRegistry,
  SearchPreview,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { quests } from "../entities/quests.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";
import {
  type CreateQuestInput,
  QuestService,
} from "../services/QuestService.ts";

/**
 * The `quest` resource (`#Q`), registered by Work: how core resolves,
 * describes, finds and creates a quest without reading `quests` itself.
 *
 * `create` is what lets another module make one: an error forwarded to a
 * quest asks this kind, never `QuestService` (#Q2610).
 */
export class QuestResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly quests = $repository(quests);
  protected readonly questService = $inject(QuestService);
  protected readonly bound = $inject(BoundParameters);
  protected readonly search = $inject(SearchPreview);
  protected readonly mapper = $inject(QuestResourceMapper);

  constructor() {
    this.resources.register({
      kind: "quest",
      letter: "Q",
      order: 10,
      permission: "quest:read",
      page: {
        name: "projectQuest",
        params: (ref) => ({ shortId: ref.shortId }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.quests.findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "shortId"],
        });
        return new Map(rows.map((r) => [r.shortId, String(r.id)]));
      },
      describe: async (_projectId, ids) => {
        const rows = await this.bound.collect(this.integers(ids), (batch) =>
          this.quests.findMany({
            where: { id: { inArray: batch } },
            columns: [
              "id",
              "shortId",
              "title",
              "acceptedAt",
              "completedAt",
              "shelvedAt",
              "heldAt",
            ],
          }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.shortId,
          title: r.title,
          // What an error forwarded to it shows beside its number (#E185).
          status: this.mapper.questStatus(r),
        }));
      },
      search: {
        find: async ({ projectId, raw, number, limit }) => {
          const rows = await this.quests.findMany({
            where: {
              projectId: { eq: projectId },
              ...(number === undefined
                ? { title: { ilike: `%${raw}%` } }
                : {
                    or: [
                      { shortId: { eq: number } },
                      { title: { ilike: `%${raw}%` } },
                    ],
                  }),
            },
            limit,
          });
          return rows.map((q) => ({
            kind: "quest" as const,
            id: String(q.id),
            shortId: q.shortId,
            title: q.title,
            description: this.search.preview(q.description),
          }));
        },
      },
      create: async (input) => {
        const quest = await this.questService.createQuest(
          input as unknown as CreateQuestInput,
        );
        return { id: quest.id, shortId: quest.shortId };
      },
      discard: async (id) => {
        await this.quests.deleteById(id, { force: true });
      },
      adopt: async ({ projectId, shortId, source }) => {
        const quest = await this.quests.findOne({
          where: { projectId: { eq: projectId }, shortId: { eq: shortId } },
        });
        if (!quest) {
          throw new NotFoundError(`No quest #Q${shortId} in this project`);
        }
        if (quest.source && Object.keys(quest.source).length > 0) {
          throw new BadRequestError(
            `Quest #Q${shortId} already has a source, which linking would overwrite`,
          );
        }
        await this.quests.updateById(quest.id, { source });
        return { id: quest.id, shortId: quest.shortId };
      },
      disown: async (id) => {
        await this.quests.updateById(id, { source: null });
      },
    });
  }

  protected integers(ids: readonly string[]): number[] {
    return ids
      .map((id) => Number.parseInt(id, 10))
      .filter((n) => Number.isFinite(n));
  }
}
