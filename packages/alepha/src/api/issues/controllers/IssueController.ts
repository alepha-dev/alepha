import { $inject, t } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { createIssueSchema } from "../schemas/createIssueSchema.ts";
import { issueResourceSchema } from "../schemas/issueResourceSchema.ts";
import { myIssueQuerySchema } from "../schemas/myIssueQuerySchema.ts";
import { IssueService } from "../services/IssueService.ts";

export class IssueController {
  protected readonly url = "/issues";
  protected readonly group = "issues";
  protected readonly issueService = $inject(IssueService);

  /**
   * Submit a new issue.
   */
  public readonly createIssue = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["issue:create"] })],
    description: "Submit a new issue",
    schema: {
      body: createIssueSchema,
      response: issueResourceSchema,
    },
    handler: ({ body, user }) => this.issueService.create(body, user),
  });

  /**
   * List issues for the current user.
   */
  public readonly getMyIssues = $action({
    path: `${this.url}/mine`,
    group: this.group,
    use: [$secure({ permissions: ["issue:read"] })],
    description: "List issues submitted by the current user",
    schema: {
      query: myIssueQuerySchema,
      response: t.page(issueResourceSchema),
    },
    handler: ({ query, user }) => this.issueService.findMine(user.id, query),
  });
}
