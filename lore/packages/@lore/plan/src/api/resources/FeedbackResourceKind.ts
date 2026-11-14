import { BoundParameters, ResourceRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { feedback } from "../entities/feedback.ts";

/**
 * The `feedback` resource (`#P`, the letter it had as Petitions), registered
 * by Work, where support lives.
 */
export class FeedbackResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly feedback = $repository(feedback);
  protected readonly bound = $inject(BoundParameters);

  constructor() {
    this.resources.register({
      kind: "feedback",
      letter: "P",
      order: 60,
      permission: "feedback:read",
      page: {
        name: "projectFeedback",
        params: () => ({}),
        query: (ref) => ({ feedback: String(ref.shortId) }),
      },
      resolveNumbers: async (projectId) => {
        const rows = await this.feedback.findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "shortId"],
        });
        return new Map(rows.map((r) => [r.shortId, String(r.id)]));
      },
      describe: async (_projectId, ids) => {
        const rows = await this.bound.collect(
          ids
            .map((id) => Number.parseInt(id, 10))
            .filter((n) => Number.isFinite(n)),
          (batch) =>
            this.feedback.findMany({
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
        numberOnly: true,
        find: async ({ projectId, number }) => {
          if (number === undefined) return [];
          const rows = await this.feedback.findMany({
            where: { projectId: { eq: projectId }, shortId: { eq: number } },
            limit: 1,
          });
          return rows.map((f) => ({
            kind: "feedback" as const,
            id: String(f.id),
            shortId: f.shortId,
            title: f.title,
          }));
        },
      },
    });
  }
}
