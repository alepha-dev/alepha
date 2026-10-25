import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { users } from "../entities/users.ts";
import type { AutomationAudiencePreview } from "../schemas/automationAudiencePreviewSchema.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";

/**
 * A read-only bounded roster preview. Native freeze and delivery still happen under the live claim.
 */
export class AutomationAudience {
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly users = $repository(users);
  public async preview(
    projectId: number,
    publisherId?: string,
  ): Promise<AutomationAudiencePreview> {
    if (!publisherId)
      throw new BadRequestError(
        "A release audience requires a retained publisher identity",
      );
    const project = await this.security.projects.getById(projectId);
    const where = {
      and: [
        sql`EXISTS (SELECT 1 FROM users WHERE users.id = ${this.security.members.table.userId} AND users.enabled = TRUE)`,
      ],
      organizationId: project.organizationId!,
      userId: { ne: publisherId },
    };
    const members = await this.security.members.findMany({
      where,
      orderBy: "userId",
      limit: 51,
    });
    const ids = members.slice(0, 50).map((member) => member.userId);
    const accounts = ids.length
      ? await this.users.findMany({
          where: { id: { inArray: ids }, enabled: true },
          columns: ["id", "username", "firstName", "lastName"],
        })
      : [];
    return {
      recipients: accounts.map((account) => ({
        value: account.id,
        label: (
          account.username ||
          [account.firstName, account.lastName].filter(Boolean).join(" ") ||
          account.id
        ).slice(0, 255),
      })),
      total: await this.security.members.count(where),
      hasMore: members.length > 50,
      excludesPublisher: true,
    };
  }
}
