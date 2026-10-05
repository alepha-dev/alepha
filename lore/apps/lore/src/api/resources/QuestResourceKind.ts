import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { BoundParameters } from "../services/BoundParameters.ts";
import {
  type CreateQuestInput,
  QuestService,
} from "../services/QuestService.ts";
import { ResourceRegistry } from "./ResourceRegistry.ts";
import { SearchPreview } from "./SearchPreview.ts";

/**
 * The `quest` resource (`#Q`), registered by Work: how core resolves,
 * describes, finds and creates a quest without reading `quests` itself.
 *
 * `create` is what lets another module make one: a blight forwarded to a
 * quest asks this kind, never `QuestService` (#Q2610).
 */
export class QuestResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly quests = $repository(quests);
  protected readonly questService = $inject(QuestService);
  protected readonly bound = $inject(BoundParameters);
  protected readonly search = $inject(SearchPreview);

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
            columns: ["id", "shortId", "title"],
          }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.shortId,
          title: r.title,
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
    });
  }

  protected integers(ids: readonly string[]): number[] {
    return ids
      .map((id) => Number.parseInt(id, 10))
      .filter((n) => Number.isFinite(n));
  }
}
