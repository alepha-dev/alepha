import {
  AutomationDatabase,
  AutomationSelections,
  type AutomationSelectionHandler,
} from "@lore/core/api";
import { $inject, z } from "alepha";
import {
  $repository,
  type PgQueryWhere,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { epics } from "../entities/epics.ts";
import { quests, REMINDER_INTERVAL_MS } from "../entities/quests.ts";
import { OpenQuestScope } from "./OpenQuestScope.ts";

/**
 * SQL predicates filter before LIMIT. We over-fetch one row for a truthful
 * lower bound, rather than loading all rows or claiming an invented total.
 */
export class WorkAutomationSelections {
  protected readonly selections = $inject(AutomationSelections);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly open = $inject(OpenQuestScope);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly sqlx = $inject(SqlExpressionProvider);
  constructor() {
    this.selections.register("quests.open", {
      select: (input) => this.select(input, false),
    });
    this.selections.register("quests.tagged", {
      select: (input) => this.select(input, false),
    });
    this.selections.register("quests.remindersDue", {
      select: (input) => this.select(input, true),
      settle: (values, at, projectId) => this.reminder(values, at, projectId),
    });
  }
  protected async select(
    input: Parameters<AutomationSelectionHandler["select"]>[0],
    reminders: boolean,
  ) {
    const where = await this.open.where([input.projectId]);
    const predicates = [...(where.and ?? [])];
    if (input.filters.tag !== undefined) {
      if (typeof input.filters.tag !== "string")
        throw new BadRequestError("Tag must be text");
      const tag = input.filters.tag.trim().toLowerCase();
      // `tags` is JSON text on SQLite and `text[]` on Postgres; the ORM's
      // `arrayContains` covers both.
      where.tags = { arrayContains: [tag] };
    }
    if (input.filters.area !== undefined) {
      if (typeof input.filters.area !== "string")
        throw new BadRequestError("Area must be text");
      where.area = input.filters.area;
    }
    if (reminders) {
      where.acceptedAt = { isNotNull: true };
      where.acceptedBy = { isNotNull: true };
      where.reminderInterval = { isNotNull: true };
      where.reminderNextAt = { lte: input.evaluatedAt, isNotNull: true };
      if (input.cursor) {
        if (!input.cursor.at)
          throw new BadRequestError(
            "Reminder cursor requires its due timestamp",
          );
        // A keyset cursor: `where.or` may already hold the epic gate, so
        // the cursor's own OR goes into the AND list.
        predicates.push({
          or: [
            { reminderNextAt: { gt: input.cursor.at } },
            {
              reminderNextAt: { eq: input.cursor.at },
              shortId: { gt: input.cursor.shortId },
            },
          ],
        });
      }
    } else if (input.cursor) where.shortId = { gt: input.cursor.shortId };
    if (predicates.length) where.and = predicates;
    const found = await this.quests.findMany({
      where: where as PgQueryWhere<typeof quests.schema>,
      columns: [
        "id",
        "shortId",
        "title",
        "area",
        "acceptedAt",
        "heldAt",
        "acceptedBy",
        "reminderInterval",
        "reminderNextAt",
      ],
      orderBy: reminders
        ? [
            { column: "reminderNextAt", direction: "asc" },
            { column: "shortId", direction: "asc" },
          ]
        : [{ column: "shortId", direction: "asc" }],
      limit: 51,
    });
    const selected = found.slice(0, 50);
    const hasMore = found.length > 50;
    const last = selected.at(-1);
    return {
      items: selected.map((quest) => ({
        quest_id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        area: quest.area,
        status: quest.heldAt
          ? "on_hold"
          : quest.acceptedAt
            ? "in_progress"
            : "todo",
        url: `/project-${input.projectId}/quests/${quest.shortId}`,
        ...(reminders
          ? {
              assignee_id: quest.acceptedBy,
              reminder_interval: quest.reminderInterval,
              reminder_interval_ms:
                REMINDER_INTERVAL_MS[quest.reminderInterval!],
              reminder_next_at: quest.reminderNextAt,
            }
          : {}),
      })),
      total: (input.cursor?.seen ?? 0) + found.length,
      totalIsExact: !hasMore,
      hasMore,
      ...(reminders && hasMore && last
        ? {
            next: {
              seen: (input.cursor?.seen ?? 0) + selected.length,
              shortId: last.shortId,
              ...(reminders ? { at: last.reminderNextAt } : {}),
            },
          }
        : {}),
    };
  }
  public reminder(
    values: Record<string, string | number | boolean | null>,
    at: string,
    projectId: number,
  ) {
    const id = values.quest_id;
    const assignee = values.assignee_id;
    const interval = values.reminder_interval;
    const due = values.reminder_next_at;
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      typeof assignee !== "string" ||
      !z.uuid().safeParse(assignee).success ||
      typeof interval !== "string" ||
      !Object.hasOwn(REMINDER_INTERVAL_MS, interval) ||
      typeof due !== "string"
    )
      throw new BadRequestError("Invalid frozen reminder context");
    const millis =
      REMINDER_INTERVAL_MS[interval as keyof typeof REMINDER_INTERVAL_MS];
    const next = new Date(new Date(at).getTime() + millis).toISOString();
    // The quest is still open, accepted by the same person, due on the same
    // instant, and outside every draft epic; the subqueries add the
    // soft-delete filters the raw guard spelled out.
    const condition = sql`EXISTS ${this.quests.subquery({
      id,
      projectId,
      completedAt: { isNull: true },
      shelvedAt: { isNull: true },
      acceptedAt: { isNotNull: true },
      acceptedBy: assignee,
      reminderInterval: interval as keyof typeof REMINDER_INTERVAL_MS,
      reminderNextAt: { eq: due, lte: at },
      or: [
        { epicId: { isNull: true } },
        {
          epicId: {
            notInArray: this.epics.subquery({ status: "draft" }, "id"),
          },
        },
      ],
    })}`;
    const append = this.sqlx.jsonArrayAppend(sql`history`, {
      at,
      by: assignee,
      action: "reminder_sent",
    });
    return {
      condition,
      statements: [
        // By id and project alone, as the guard above checked the row:
        // `force`, since the raw statement had no soft-delete filter.
        this.quests.updateStatement(
          { id, projectId },
          { reminderNextAt: next, history: append as never },
          { now: at, force: true, returning: false },
        ),
      ],
      changedTables: ["quests"],
    };
  }
}
