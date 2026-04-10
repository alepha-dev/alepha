import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import { type IssueEntity, issues } from "../entities/issues.ts";
import type { CreateIssue } from "../schemas/createIssueSchema.ts";
import { issueConfigAtom } from "../schemas/issueConfigAtom.ts";
import type { IssueQuery } from "../schemas/issueQuerySchema.ts";
import type { MyIssueQuery } from "../schemas/myIssueQuerySchema.ts";
import type { UpdateIssue } from "../schemas/updateIssueSchema.ts";

export class IssueService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly repo = $repository(issues);
  protected readonly dateTime = $inject(DateTimeProvider);

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Get an issue by ID.
   */
  public async getById(id: string): Promise<IssueEntity> {
    return this.repo.getById(id);
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Create a new issue.
   */
  public async create(
    data: CreateIssue,
    createdBy: { id: string },
  ): Promise<IssueEntity> {
    const config = this.alepha.store.get(issueConfigAtom);

    if (!config.enabled) {
      throw new BadRequestError("Issue submission is disabled");
    }

    const openCount = await this.repo.count({
      createdBy: { eq: createdBy.id },
      status: { inArray: ["open", "assigned"] },
    });

    if (openCount >= config.maxOpenPerUser) {
      throw new BadRequestError(
        `Maximum open issues per user reached (${config.maxOpenPerUser})`,
      );
    }

    const entity = await this.repo.create({
      createdBy: createdBy.id,
      title: data.title,
      type: data.type ?? "bug",
      priority: data.priority ?? "medium",
      status: "open",
      description: data.description,
      pageUrl: data.pageUrl,
    });

    this.log.info("Issue created", { id: entity.id, createdBy: createdBy.id });

    await this.alepha.events.emit("issue:created", { issue: entity });

    return entity;
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Find issues for the current user.
   */
  public async findMine(
    userId: string,
    query: MyIssueQuery = {},
  ): Promise<Page<IssueEntity>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();
    where.createdBy = { eq: userId };

    if (query.status) {
      where.status = { eq: query.status };
    }

    return this.repo.paginate(query, { where }, { count: true });
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Find issues with pagination and filtering (admin).
   */
  public async find(query: IssueQuery = {}): Promise<Page<IssueEntity>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.status) {
      where.status = { eq: query.status };
    }

    if (query.type) {
      where.type = { eq: query.type };
    }

    if (query.priority) {
      where.priority = { eq: query.priority };
    }

    if (query.assigneeId) {
      where.assigneeId = { eq: query.assigneeId };
    }

    if (query.search) {
      where.title = { ilike: `%${query.search}%` };
    }

    return this.repo.paginate(query, { where }, { count: true });
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Update issue fields (admin).
   */
  public async update(id: string, data: UpdateIssue): Promise<IssueEntity> {
    return this.repo.updateById(id, data);
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Assign an issue to a user.
   */
  public async assign(id: string, assigneeId: string): Promise<IssueEntity> {
    const issue = await this.repo.getById(id);

    if (issue.status !== "open") {
      throw new BadRequestError(
        `Cannot assign issue in "${issue.status}" status (must be "open")`,
      );
    }

    const updated = await this.repo.updateById(id, {
      status: "assigned",
      assigneeId,
      assignedAt: this.dateTime.nowISOString(),
    });

    this.log.info("Issue assigned", { id, assigneeId });

    await this.alepha.events.emit("issue:assigned", {
      issue: updated,
      assigneeId,
    });

    return updated;
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Complete an issue with resolution notes.
   */
  public async complete(id: string, resolution: string): Promise<IssueEntity> {
    const issue = await this.repo.getById(id);

    if (issue.status !== "assigned") {
      throw new BadRequestError(
        `Cannot complete issue in "${issue.status}" status (must be "assigned")`,
      );
    }

    const updated = await this.repo.updateById(id, {
      status: "completed",
      resolution,
      completedAt: this.dateTime.nowISOString(),
    });

    this.log.info("Issue completed", { id });

    await this.alepha.events.emit("issue:completed", { issue: updated });

    return updated;
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Reopen a completed issue.
   */
  public async reopen(id: string, reason: string): Promise<IssueEntity> {
    const issue = await this.repo.getById(id);

    if (issue.status !== "completed") {
      throw new BadRequestError(
        `Cannot reopen issue in "${issue.status}" status (must be "completed")`,
      );
    }

    const updated = await this.repo.updateById(id, {
      status: "open",
      reopenReason: reason,
      assigneeId: undefined,
      assignedAt: undefined,
      resolution: undefined,
      completedAt: undefined,
    });

    this.log.info("Issue reopened", { id, reason });

    await this.alepha.events.emit("issue:reopened", {
      issue: updated,
      reason,
    });

    return updated;
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Archive a completed issue.
   */
  public async archive(id: string): Promise<IssueEntity> {
    const issue = await this.repo.getById(id);

    if (issue.status !== "completed") {
      throw new BadRequestError(
        `Cannot archive issue in "${issue.status}" status (must be "completed")`,
      );
    }

    const updated = await this.repo.updateById(id, {
      status: "archived",
      archivedAt: this.dateTime.nowISOString(),
    });

    this.log.info("Issue archived", { id });

    await this.alepha.events.emit("issue:archived", { issue: updated });

    return updated;
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Delete an issue.
   */
  public async deleteIssue(id: string): Promise<void> {
    const issue = await this.repo.getById(id);

    await this.repo.deleteById(id);

    this.log.info("Issue deleted", { id });

    await this.alepha.events.emit("issue:deleted", { issue });
  }
}
