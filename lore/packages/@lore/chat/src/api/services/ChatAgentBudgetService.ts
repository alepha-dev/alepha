import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { chatAgentBudgets } from "../entities/chatAgentBudgets.ts";
import { chatAgentCharges } from "../entities/chatAgentCharges.ts";
import type { ChatAgentBudgetResource } from "../schemas/chatAgentBudgetResourceSchema.ts";

/**
 * A project's AI budget for its chat agents (#Q4237): a run draws on it
 * first, and falls back to the mentioner's own budget once it is spent.
 *
 * Chat keeps the budget and what it paid for; the app's assistant decides
 * who pays a run and records the charge, since the tokens are counted by the
 * AI module chat does not import.
 */
export class ChatAgentBudgetService {
  protected readonly budgets = $repository(chatAgentBudgets);
  protected readonly charges = $repository(chatAgentCharges);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The window a budget counts over, in hours. The app sets it to the
   * instance's `api.ai` window at boot, so a member's budget and a
   * project's agree; 24 until then.
   */
  public windowHours: () => number = () => 24;

  /**
   * The project's budget in tokens, or none.
   */
  public async limitOf(projectId: number): Promise<number | undefined> {
    const row = await this.budgets.findOne({
      where: { projectId: { eq: projectId } },
    });
    return row?.tokens;
  }

  /**
   * Sets the project's budget, or removes it with `undefined`.
   */
  public async setLimit(
    projectId: number,
    tokens: number | undefined,
    userId: string,
  ): Promise<void> {
    const row = await this.budgets.findOne({
      where: { projectId: { eq: projectId } },
    });
    if (tokens === undefined) {
      if (row) await this.budgets.deleteById(row.id);
      return;
    }
    if (row) {
      await this.budgets.updateById(row.id, { tokens, updatedBy: userId });
      return;
    }
    await this.budgets.create({ projectId, tokens, updatedBy: userId });
  }

  /**
   * The start of the current window, ISO.
   */
  public windowStart(): string {
    return this.dateTime
      .now()
      .subtract(this.windowHours(), "hour")
      .toISOString();
  }

  /**
   * The project's budget and what it paid for over the window, or
   * `undefined` with no budget.
   */
  public async usage(
    projectId: number,
  ): Promise<
    | { used: number; limit: number; rows: { at: string; tokens: number }[] }
    | undefined
  > {
    const limit = await this.limitOf(projectId);
    if (limit === undefined) return undefined;
    const rows = await this.charges.findMany({
      where: {
        projectId: { eq: projectId },
        createdAt: { gte: this.windowStart() },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    return {
      limit,
      used: rows.reduce((sum, row) => sum + row.tokens, 0),
      rows: rows.map((row) => ({ at: row.createdAt, tokens: row.tokens })),
    };
  }

  /**
   * What projects paid for `userId`'s runs over the window: the tokens their
   * own budget must not count a second time.
   */
  public async chargedFor(userId: string): Promise<number> {
    const rows = await this.charges.findMany({
      where: {
        userId: { eq: userId },
        createdAt: { gte: this.windowStart() },
      },
      columns: ["tokens"],
    });
    return rows.reduce((sum, row) => sum + row.tokens, 0);
  }

  /**
   * Records a run the project paid for.
   */
  public async charge(input: {
    projectId: number;
    userId: string;
    conversationId?: string;
    tokens: number;
  }): Promise<void> {
    if (input.tokens <= 0) return;
    await this.charges.create(input);
  }

  /**
   * When enough of a window's spending ages out for `used` to drop under
   * `limit`: the oldest rows leave first, each `windowHours` after it was
   * spent. `undefined` while there is budget left.
   */
  public freesAt(
    rows: { at: string; tokens: number }[],
    used: number,
    limit: number,
  ): string | undefined {
    if (used < limit) return undefined;
    let left = used;
    for (const row of [...rows].sort((a, b) => a.at.localeCompare(b.at))) {
      left -= row.tokens;
      if (left < limit) {
        return this.dateTime
          .of(row.at)
          .add(this.windowHours(), "hour")
          .toISOString();
      }
    }
    return undefined;
  }

  /**
   * The budget as Settings shows it.
   */
  public async status(projectId: number): Promise<ChatAgentBudgetResource> {
    const usage = await this.usage(projectId);
    const freesAt = usage
      ? this.freesAt(usage.rows, usage.used, usage.limit)
      : undefined;
    return {
      ...(usage ? { tokens: usage.limit } : {}),
      spent: usage?.used ?? 0,
      windowHours: this.windowHours(),
      ...(freesAt ? { freesAt } : {}),
    };
  }
}
