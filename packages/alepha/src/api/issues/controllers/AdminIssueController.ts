import { $inject, t } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { issueQuerySchema } from "../schemas/issueQuerySchema.ts";
import { issueResourceSchema } from "../schemas/issueResourceSchema.ts";
import { updateIssueSchema } from "../schemas/updateIssueSchema.ts";
import { IssueService } from "../services/IssueService.ts";

export class AdminIssueController {
  protected readonly url = "/issues";
  protected readonly group = "admin:issues";
  protected readonly issueService = $inject(IssueService);

  /**
   * Find issues with pagination and filtering.
   */
  public readonly findIssues = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:read"] })],
    description: "Find issues with pagination and filtering",
    schema: {
      query: issueQuerySchema,
      response: t.page(issueResourceSchema),
    },
    handler: ({ query }) => this.issueService.find(query),
  });

  /**
   * Get an issue by ID.
   */
  public readonly getIssue = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:read"] })],
    description: "Get an issue by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: issueResourceSchema,
    },
    handler: ({ params }) => this.issueService.getById(params.id),
  });

  /**
   * Update issue fields.
   */
  public readonly updateIssue = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:update"] })],
    description: "Update issue fields",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: updateIssueSchema,
      response: issueResourceSchema,
    },
    handler: ({ params, body }) => this.issueService.update(params.id, body),
  });

  /**
   * Assign an issue to a user.
   */
  public readonly assignIssue = $action({
    method: "POST",
    path: `${this.url}/:id/assign`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:update"] })],
    description: "Assign an issue to a user",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({ assigneeId: t.uuid() }),
      response: issueResourceSchema,
    },
    handler: ({ params, body }) =>
      this.issueService.assign(params.id, body.assigneeId),
  });

  /**
   * Mark an issue as completed.
   */
  public readonly completeIssue = $action({
    method: "POST",
    path: `${this.url}/:id/complete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:update"] })],
    description: "Mark an issue as completed with resolution notes",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({ resolution: t.text({ minLength: 1 }) }),
      response: issueResourceSchema,
    },
    handler: ({ params, body }) =>
      this.issueService.complete(params.id, body.resolution),
  });

  /**
   * Reopen a completed issue.
   */
  public readonly reopenIssue = $action({
    method: "POST",
    path: `${this.url}/:id/reopen`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:update"] })],
    description: "Reopen a completed issue with a reason",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({ reason: t.text({ minLength: 1 }) }),
      response: issueResourceSchema,
    },
    handler: ({ params, body }) =>
      this.issueService.reopen(params.id, body.reason),
  });

  /**
   * Archive a completed issue.
   */
  public readonly archiveIssue = $action({
    method: "POST",
    path: `${this.url}/:id/archive`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:update"] })],
    description: "Archive a completed issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: issueResourceSchema,
    },
    handler: ({ params }) => this.issueService.archive(params.id),
  });

  /**
   * Delete an issue.
   */
  public readonly deleteIssue = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:issue:delete"] })],
    description: "Delete an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.issueService.deleteIssue(params.id);
      return { ok: true, id: params.id };
    },
  });
}
