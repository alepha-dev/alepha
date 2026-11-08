import { formatReference } from "@lore/core/web";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";

import {
  type EpicReviewItem,
  epicReviewItems,
} from "../entities/epicReviewItems.ts";
import { type EpicReview, epicReviews } from "../entities/epicReviews.ts";
import type { Epic } from "../entities/epics.ts";
import type { EpicReviewItemKind } from "../schemas/epicReviewItemKindSchema.ts";
import type { EpicReviewsResult } from "../schemas/epicReviewsResultSchema.ts";
import type { EpicReviewSuggestion } from "../schemas/epicReviewSuggestionSchema.ts";
import type { EpicReviewTarget } from "../schemas/epicReviewTargetSchema.ts";
import { EpicWorkflowService } from "./EpicWorkflowService.ts";

/**
 * One item as a reviewer files it: everything but what the service decides
 * (the number, the state, the answer).
 */
export interface EpicReviewItemInput {
  kind: EpicReviewItemKind;
  title: string;
  context?: string;
  suggestions?: EpicReviewSuggestion[];
  recommended?: number;
  target?: EpicReviewTarget;
}

/**
 * How the owner answers an item: their own text, a suggestion by its index,
 * or a waive. Exactly one.
 */
export interface EpicReviewAnswerInput {
  answer?: string;
  suggestion?: number;
  waive?: boolean;
}

/**
 * What an answer did: the item it answered, and on an overturn the decision
 * it filed in place of the old one.
 */
export interface EpicReviewAnswerResult {
  item: EpicReviewItem;
  replacement?: EpicReviewItem;
  /**
   * `answered`, `waived` or `overturned`, the word the audit row and the
   * tool result carry.
   */
  outcome: "answered" | "waived" | "overturned";
}

/**
 * Epic reviews (#E121, folio #F1460): every rule on the two tables, once.
 *
 * - **One call files a review with all its items**, so a review is never
 *   half written: the numbers are allocated first, then the review row,
 *   then every item in ONE insert. D1 has no transaction, and a failure
 *   between the two writes leaves a review with no items, which reads as an
 *   empty review and is valid; a retry files the review again.
 * - **Item numbers are per epic** and never reused: a `$sequence` scoped on
 *   the epic id, so the third item of the second review continues from the
 *   last item of the first.
 * - **Status is the permission**: every write goes through
 *   `EpicWorkflowService.assertReviewWritable` first, `draft` and `ready`
 *   only.
 * - **Overturning a decision files a new decision** naming the one it
 *   replaces (`replaces`), and marks the old one (`replacedBy`), so the log
 *   holds the decision that stands and the record keeps both.
 *
 * Who may write (`epic:write`) is the actions' gate, not this service's.
 */
export class EpicReviewService {
  protected readonly reviews = $repository(epicReviews);
  protected readonly items = $repository(epicReviewItems);
  protected readonly workflow = $inject(EpicWorkflowService);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Per-epic counter for `epic_review_items.number`. `$sequence` keys its
   * counter on the PROPERTY NAME: renaming this property restarts every
   * epic's numbering at 1 and collides with the unique index. A rename
   * needs an `UPDATE alepha_sequences SET name` in a migration.
   */
  protected reviewItemNumber = $sequence();

  /**
   * File a review with its items, and answer both with the numbers given.
   */
  async create(
    epic: Pick<Epic, "id" | "number" | "status" | "projectId">,
    user: UserAccountToken | undefined,
    input: { summary?: string; items: EpicReviewItemInput[] },
  ): Promise<{ review: EpicReview; items: EpicReviewItem[] }> {
    this.workflow.assertReviewWritable(epic, "file a review");
    input.items.forEach((item, index) => this.assertItemShape(item, index));

    const numbers: number[] = [];
    for (const _item of input.items) {
      numbers.push(await this.reviewItemNumber.next(String(epic.id)));
    }

    const review = await this.reviews.create({
      projectId: epic.projectId,
      epicId: epic.id,
      summary: input.summary ?? "",
      ...(user ? { createdBy: user.id } : {}),
    });

    const items = await this.items.createMany(
      input.items.map((item, index) => ({
        reviewId: review.id,
        epicId: epic.id,
        number: numbers[index]!,
        kind: item.kind,
        title: item.title,
        context: item.context ?? "",
        suggestions: item.suggestions ?? [],
        ...(item.recommended !== undefined
          ? { recommended: item.recommended }
          : {}),
        ...(item.kind === "question" ? { state: "open" as const } : {}),
        ...(item.target ? { target: item.target } : {}),
      })),
    );

    return { review, items };
  }

  /**
   * Answer a question, pick one of its suggestions, waive it, or overturn a
   * decision, by the item's per-epic number.
   *
   * A question may be answered again: the owner changing their mind is a
   * new answer, and the audit row keeps the old one. A decision is
   * overturned once; the decision that replaced it is the one to overturn
   * next. A change item is a record and takes no answer.
   */
  async answer(
    epic: Pick<Epic, "id" | "number" | "status">,
    number: number,
    user: UserAccountToken | undefined,
    input: EpicReviewAnswerInput,
  ): Promise<EpicReviewAnswerResult> {
    this.workflow.assertReviewWritable(epic, `answer item ${number}`);

    const given =
      Number(input.answer !== undefined && input.answer.trim() !== "") +
      Number(input.suggestion !== undefined) +
      Number(input.waive === true);
    if (given !== 1) {
      throw new BadRequestError(
        `Answer item ${number} with exactly one of: an answer text, a suggestion index, or waive.`,
      );
    }

    const item = await this.get(epic, number);
    if (item.kind === "change") {
      throw new BadRequestError(
        `Cannot answer item ${number} of Epic ${formatReference("epic", epic.number)}: it is a change the review made, not a question or a decision.`,
      );
    }

    const text = this.answerText(item, input);
    const stamp = {
      answeredAt: this.dt.nowISOString(),
      ...(user ? { answeredBy: user.id } : {}),
    };

    if (item.kind === "question") {
      const updated = await this.items.updateById(item.id, {
        ...stamp,
        state: input.waive ? "waived" : "answered",
        answer: text ?? null,
        answerSuggestion: input.suggestion ?? null,
      } as Partial<EpicReviewItem>);
      return { item: updated, outcome: input.waive ? "waived" : "answered" };
    }

    if (input.waive) {
      throw new BadRequestError(
        `Cannot waive item ${number} of Epic ${formatReference("epic", epic.number)}: it is a decision. Overturn it with an answer, or leave it standing.`,
      );
    }
    if (item.replacedBy != null) {
      throw new BadRequestError(
        `Cannot overturn item ${number} of Epic ${formatReference("epic", epic.number)}: item ${item.replacedBy} already replaced it. Overturn item ${item.replacedBy} instead.`,
      );
    }

    const replacementNumber = await this.reviewItemNumber.next(String(epic.id));
    const replacement = await this.items.create({
      reviewId: item.reviewId,
      epicId: epic.id,
      number: replacementNumber,
      kind: "decision",
      title: text!,
      context: `Overturns decision ${number}: ${item.title}`,
      suggestions: [],
      replaces: number,
      ...(user ? { createdBy: user.id } : {}),
    });
    const updated = await this.items.updateById(item.id, {
      ...stamp,
      answer: text,
      ...(input.suggestion !== undefined
        ? { answerSuggestion: input.suggestion }
        : {}),
      replacedBy: replacementNumber,
    });
    return { item: updated, replacement, outcome: "overturned" };
  }

  /**
   * Every review of an epic, newest first, each with its items by number,
   * and the open-question count: what `getEpicReviews` and `epic_get`
   * answer. Two reads, side by side.
   */
  async resultOf(epicId: number): Promise<EpicReviewsResult> {
    const [reviews, items] = await Promise.all([
      this.reviewsOf(epicId),
      this.itemsOf(epicId),
    ]);
    const byReview = new Map<number, EpicReviewItem[]>();
    for (const item of items) {
      const list = byReview.get(item.reviewId) ?? [];
      list.push(item);
      byReview.set(item.reviewId, list);
    }
    return {
      reviews: reviews.map((review) => ({
        ...review,
        items: byReview.get(review.id) ?? [],
      })),
      openQuestions: items.filter((item) => item.state === "open").length,
    };
  }

  /**
   * Every review of an epic, newest first, for the Review tab's timeline.
   */
  async reviewsOf(epicId: number): Promise<EpicReview[]> {
    return await this.reviews.findMany({
      where: { epicId: { eq: epicId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
  }

  /**
   * Every item of an epic, by number.
   */
  async itemsOf(epicId: number): Promise<EpicReviewItem[]> {
    return await this.items.findMany({
      where: { epicId: { eq: epicId } },
      orderBy: [{ column: "number", direction: "asc" }],
    });
  }

  /**
   * The questions still open, by number.
   */
  async openQuestionsOf(epicId: number): Promise<EpicReviewItem[]> {
    return await this.items.findMany({
      where: { epicId: { eq: epicId }, state: { eq: "open" } },
      orderBy: [{ column: "number", direction: "asc" }],
    });
  }

  /**
   * The epic's decision log: answered questions and the decisions that
   * stand (an overturned one has left it for its replacement), by number.
   * A waived question is not a decision, and a change is not one either.
   */
  async logOf(epicId: number): Promise<EpicReviewItem[]> {
    const items = await this.itemsOf(epicId);
    return items.filter((item) => this.inLog(item));
  }

  /**
   * Whether an item belongs to the decision log.
   */
  inLog(item: Pick<EpicReviewItem, "kind" | "state" | "replacedBy">): boolean {
    if (item.kind === "question") return item.state === "answered";
    return item.kind === "decision" && item.replacedBy == null;
  }

  /**
   * How many questions are still open on one epic.
   */
  async countOpenQuestions(epicId: number): Promise<number> {
    return await this.items.count({
      epicId: { eq: epicId },
      state: { eq: "open" },
    });
  }

  /**
   * How many questions are still open on each of these epics, in one read,
   * for the epic list. An epic with none is absent from the map.
   */
  async countOpenQuestionsOf(epicIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (epicIds.length === 0) return counts;
    const rows = await this.items.findMany({
      where: { epicId: { inArray: epicIds }, state: { eq: "open" } },
      columns: ["epicId"],
    });
    for (const row of rows) {
      counts.set(row.epicId, (counts.get(row.epicId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Delete every review of an epic, items first. `EpicController.deleteEpic`
   * calls it before the epic goes, so nothing rests on the cascade.
   */
  async deleteOf(epicId: number): Promise<void> {
    await this.items.deleteMany({ epicId: { eq: epicId } });
    await this.reviews.deleteMany({ epicId: { eq: epicId } });
  }

  /**
   * One item by its per-epic number, or a 404 naming it.
   */
  async get(
    epic: Pick<Epic, "id" | "number">,
    number: number,
  ): Promise<EpicReviewItem> {
    const item = await this.items.findOne({
      where: { epicId: { eq: epic.id }, number: { eq: number } },
    });
    if (!item) {
      throw new NotFoundError(
        `Epic ${formatReference("epic", epic.number)} has no review item ${number}.`,
      );
    }
    return item;
  }

  /**
   * The text an answer records: the owner's own, or the suggestion it
   * picked. `undefined` for a waive.
   */
  protected answerText(
    item: Pick<EpicReviewItem, "number" | "suggestions">,
    input: EpicReviewAnswerInput,
  ): string | undefined {
    if (input.suggestion !== undefined) {
      const picked = item.suggestions[input.suggestion];
      if (!picked) {
        throw new BadRequestError(
          `Item ${item.number} has ${item.suggestions.length} suggestions; there is no suggestion ${input.suggestion} (they are numbered from 0).`,
        );
      }
      return picked.label;
    }
    return input.answer?.trim() || undefined;
  }

  /**
   * Refuse an item whose fields contradict its kind, before anything is
   * written. `index` is its position in the call, the only name it has yet.
   */
  protected assertItemShape(item: EpicReviewItemInput, index: number): void {
    const where = `Item ${index + 1} of the review`;
    if (
      item.recommended !== undefined &&
      item.recommended >= (item.suggestions?.length ?? 0)
    ) {
      throw new BadRequestError(
        `${where} recommends suggestion ${item.recommended}, but has ${item.suggestions?.length ?? 0} suggestions (numbered from 0).`,
      );
    }
    if (item.target && item.kind !== "change") {
      throw new BadRequestError(
        `${where} is a ${item.kind} with a target; only a change names the quest or epic it touched.`,
      );
    }
  }
}
