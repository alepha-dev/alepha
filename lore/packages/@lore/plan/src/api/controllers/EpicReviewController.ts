import { $ownsProject, LoreAudits } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import { $action } from "alepha/server";

import type { EpicReviewItem } from "../entities/epicReviewItems.ts";
import { type Epic, epics } from "../entities/epics.ts";
import { epicReviewAnswerResponseSchema } from "../schemas/epicReviewAnswerResponseSchema.ts";
import { epicReviewAnswerSchema } from "../schemas/epicReviewAnswerSchema.ts";
import { epicReviewCreateSchema } from "../schemas/epicReviewCreateSchema.ts";
import { epicReviewResourceSchema } from "../schemas/epicReviewResourceSchema.ts";
import { epicReviewsResultSchema } from "../schemas/epicReviewsResultSchema.ts";
import { EpicReviewService } from "../services/EpicReviewService.ts";

/**
 * Epic reviews over HTTP (#E121, folio #F1460): read an epic's reviews, file
 * one, answer an item. The web's Review tab, the MCP tools and the `lore
 * epic review` commands all arrive here, so the rules (`EpicReviewService`)
 * and the Activity rows are written once.
 *
 * Addressed by the epic's id, gated like `EpicController`'s epic actions:
 * reading needs `epic:read`, filing and answering `epic:write` and the Work
 * capability. Whether the epic's status allows the write is the service's
 * refusal, which names the epic.
 *
 * **Every review and every answer is an `$audit` row on the epic** (owner's
 * call of 2026-11-08): `review` and `answer`, keyed by the epic NUMBER like
 * every epic row (`EpicController.logEpic`), so they appear on the epic's
 * Activity tab and in the project feed by the existing read path. Neither
 * coalesces: each is its own event.
 */
export class EpicReviewController {
  protected readonly epics = $repository(epics);
  protected readonly reviews = $inject(EpicReviewService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly owned = $inject(OwnedResourceProvider);

  /**
   * Member gate on the project of the epic `params.id` names; the epic lands
   * on `this.owned.get<Epic>()`. Declared above the actions: a field
   * initializer reading a field declared below it sees `undefined`.
   */
  protected ownsEpic = (requires: string) =>
    $ownsProject({ requires, repository: () => this.epics, param: "id" });

  protected ownsEpicForWork = (requires: string) =>
    $ownsProject({
      requires,
      repository: () => this.epics,
      param: "id",
      capability: "plan",
    });

  getEpicReviews = $action({
    method: "GET",
    path: "/getEpicReviews/:id",
    use: [this.ownsEpic("epic:read")],
    schema: {
      params: z.object({ id: z.integer() }),
      response: epicReviewsResultSchema,
    },
    handler: async () => {
      return await this.reviews.resultOf(this.owned.get<Epic>().id);
    },
  });

  /**
   * File a review with every item, in one call. Refused unless the epic is
   * `draft` or `ready`. Answers the review with its items, whose numbers are
   * what the reviewer quotes back.
   */
  createEpicReview = $action({
    method: "POST",
    path: "/createEpicReview/:id",
    use: [this.ownsEpicForWork("epic:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: epicReviewCreateSchema,
      response: epicReviewResourceSchema,
    },
    handler: async ({ body, user }) => {
      const epic = this.owned.get<Epic>();
      const { review, items } = await this.reviews.create(epic, user, body);

      const count = (kind: EpicReviewItem["kind"]) =>
        items.filter((item) => item.kind === kind).length;
      await this.log("review", epic, user, {
        review: review.id,
        questions: count("question"),
        decisions: count("decision"),
        changes: count("change"),
        items: items.map((item) => item.number),
      });

      return { ...review, items };
    },
  });

  /**
   * Answer a question, pick a suggestion, waive it, or overturn a decision,
   * by the item's per-epic number. Refused once the epic is in progress.
   */
  answerEpicReviewItem = $action({
    method: "POST",
    path: "/answerEpicReviewItem/:id/:number",
    use: [this.ownsEpicForWork("epic:write")],
    schema: {
      params: z.object({ id: z.integer(), number: z.integer() }),
      body: epicReviewAnswerSchema,
      response: epicReviewAnswerResponseSchema,
    },
    handler: async ({ params, body, user }) => {
      const epic = this.owned.get<Epic>();
      const result = await this.reviews.answer(epic, params.number, user, body);

      await this.log("answer", epic, user, {
        item: params.number,
        outcome: result.outcome,
        ...(body.suggestion !== undefined
          ? { suggestion: body.suggestion }
          : {}),
        ...(result.replacement
          ? { replacement: result.replacement.number }
          : {}),
      });

      return result;
    },
  });

  /**
   * One `epic` audit row, keyed by the epic's per-project number, as
   * `EpicController.logEpic` writes them.
   */
  protected async log(
    action: "review" | "answer",
    epic: Pick<Epic, "number" | "title" | "projectId">,
    user: UserAccountToken | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.epic.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(epic.projectId),
      resourceType: "epic",
      resourceId: String(epic.number),
      description: epic.title,
      metadata,
    });
  }
}
