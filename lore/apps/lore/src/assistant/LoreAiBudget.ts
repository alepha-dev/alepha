import { ChatAgentBudgetService } from "@lore/chat/api";
import { McpProjectScope } from "@lore/core/api";
import { $inject } from "alepha";
import { AiBudgetService, aiMessageEntity } from "alepha/api/ai";
import { $repository } from "alepha/orm";

/**
 * The AI budget with a project's share (#Q4237): a chat agent run draws on
 * its project's budget first, and on the mentioner's own once that is
 * spent.
 *
 * Substituted for `AiBudgetService`, so `AiChatService` hands a run the
 * right `tokenBudget` without knowing projects exist: inside a run pinned to
 * a project (`McpProjectScope.pinned`, every chat agent run) whose budget
 * has tokens left, `remaining()` is the project's. Everywhere else it is the
 * member's, less what projects paid for their runs over the window, since
 * those tokens are on the member's own `ai_messages` rows too.
 */
export class LoreAiBudget extends AiBudgetService {
  protected readonly projects = $inject(ChatAgentBudgetService);
  protected readonly scope = $inject(McpProjectScope);
  protected readonly messages = $repository(aiMessageEntity);

  /**
   * Who pays the next run of `userId` in `projectId`: the project while its
   * budget has tokens left, else the member.
   */
  public async payer(projectId: number): Promise<"project" | "member"> {
    const usage = await this.projects.usage(projectId);
    return usage && usage.used < usage.limit ? "project" : "member";
  }

  /**
   * Why `userId` may not start a run in `projectId`, naming the budget that
   * ran out and when enough of it frees up; `undefined` when a run may
   * start.
   */
  public async refusal(
    userId: string,
    projectId: number,
  ): Promise<string | undefined> {
    // The project's window reads `settings.current`: load it first (#Q4244).
    const { budgetWindowHours: hours } = await this.settings.load();
    const project = await this.projects.usage(projectId);
    if (project && project.used < project.limit) return undefined;
    const member = await this.memberUsage(userId);
    if (!member || member.used < member.limit) return undefined;
    const when = (iso: string | undefined) =>
      iso
        ? ` Enough frees up at ${iso.slice(0, 16).replace("T", " ")} UTC.`
        : "";
    const mine = `your own AI budget is spent too: ${member.used} of ${member.limit} tokens over the last ${hours} hours.${when(
      this.projects.freesAt(member.rows, member.used, member.limit),
    )}`;
    if (!project) {
      return `Your AI budget is spent: ${member.used} of ${member.limit} tokens over the last ${hours} hours.${when(
        this.projects.freesAt(member.rows, member.used, member.limit),
      )}`;
    }
    return `This project's AI budget for agents is spent: ${project.used} of ${project.limit} tokens over the last ${hours} hours.${when(
      this.projects.freesAt(project.rows, project.used, project.limit),
    )} And ${mine}`;
  }

  /**
   * The tokens a run spent: its conversation's assistant rows since it
   * started.
   */
  public async spentSince(
    conversationId: string,
    since: string,
  ): Promise<number> {
    const rows = await this.messages.findMany({
      where: {
        conversationId: { eq: conversationId },
        role: { eq: "assistant" },
        createdAt: { gte: since },
      },
      columns: ["inputTokens", "outputTokens"],
    });
    return rows.reduce(
      (sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0),
      0,
    );
  }

  protected override async usage(
    userId: string,
  ): Promise<{ used: number; limit: number } | undefined> {
    await this.settings.load();
    const pinned = this.scope.pinnedProject();
    if (pinned !== undefined) {
      const project = await this.projects.usage(pinned);
      if (project && project.used < project.limit) {
        return { used: project.used, limit: project.limit };
      }
    }
    const member = await this.memberUsage(userId);
    return member ? { used: member.used, limit: member.limit } : undefined;
  }

  /**
   * The member's own budget: their rows over the window, less what projects
   * paid for, each row kept for when the window frees enough.
   */
  protected async memberUsage(
    userId: string,
  ): Promise<
    | { used: number; limit: number; rows: { at: string; tokens: number }[] }
    | undefined
  > {
    const { budgetTokens } = await this.settings.load();
    if (!budgetTokens) return undefined;
    const rows = await this.messages.findMany({
      where: {
        userId: { eq: userId },
        role: { eq: "assistant" },
        createdAt: { gte: this.projects.windowStart() },
      },
      columns: ["createdAt", "inputTokens", "outputTokens"],
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    const spent = rows.map((row) => ({
      at: row.createdAt,
      tokens: (row.inputTokens ?? 0) + (row.outputTokens ?? 0),
    }));
    const paid = await this.projects.chargedFor(userId);
    const used = Math.max(
      0,
      spent.reduce((sum, row) => sum + row.tokens, 0) - paid,
    );
    return { used, limit: budgetTokens, rows: spent };
  }
}
