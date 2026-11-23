import { ProjectSecurityService } from "@lore/core/api";
import { $inject, type Infer } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import type { codeAuthorSchema } from "../schemas/codeAuthorSchema.ts";

/**
 * Commit author emails as project members (#Q4136): one users query and
 * one memberships query a page, never one a row. An email no member holds
 * stays the name git recorded.
 */
export class CodeAuthors {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly users = $repository(users);
  protected readonly members = $repository(organizationMembers);

  public async of(
    projectId: number,
    emails: string[],
  ): Promise<Map<string, Infer<typeof codeAuthorSchema>>> {
    const found = new Map<string, Infer<typeof codeAuthorSchema>>();
    const wanted = [
      ...new Set(emails.map((it) => it.toLowerCase()).filter(Boolean)),
    ].slice(0, 50);
    if (wanted.length === 0) return found;
    const project = await this.security.projects.findById(projectId);
    if (!project?.organizationId) return found;
    const rows = await this.users.findMany({
      where: { email: { inArray: wanted } },
    });
    if (rows.length === 0) return found;
    const memberships = await this.members.findMany({
      where: {
        organizationId: { eq: project.organizationId },
        userId: { inArray: rows.map((row) => row.id) },
      },
    });
    const isMember = new Set(memberships.map((row) => row.userId));
    for (const row of rows) {
      if (!row.email || !isMember.has(row.id)) continue;
      found.set(row.email.toLowerCase(), {
        userId: row.id,
        username: row.username ?? undefined,
        picture: row.picture ?? undefined,
      });
    }
    return found;
  }
}
