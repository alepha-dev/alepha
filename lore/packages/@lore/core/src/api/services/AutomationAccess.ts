import { $inject } from "alepha";
import { apiKeyEntity } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { users } from "../entities/users.ts";
import { AutomationProjectPermissions } from "../security/AutomationProjectPermissions.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";

/**
 * Shared normal-authoring gate. Execution additionally reconstructs the live
 * author's key ceiling before every effect; it never uses the job's token.
 */
export class AutomationAccess {
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly permissions = $inject(AutomationProjectPermissions);

  protected readonly users = $repository(users);
  protected readonly keys = $repository(apiKeyEntity);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async assert(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
  ): Promise<void> {
    await this.authorize(projectId, user, permission);
  }

  public async authorize(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
  ) {
    const { project, member } = await this.membership(projectId, user);
    const allowed = await this.permissions.of(
      projectId,
      { ...user, ownership: true },
      member,
    );
    if (!allowed.permissions.includes(permission))
      throw new ForbiddenError(`Missing ${permission}`);
    await this.security.assertCapability(projectId, "work", {
      option: "automations",
      action: "use automations",
    });
    return {
      project,
      member,
      permissions: allowed.permissions,
      capabilities: await this.security.capabilitiesOf(projectId),
    };
  }

  public async assertOwner(
    projectId: number,
    user: UserAccountToken,
  ): Promise<void> {
    const { member } = await this.membership(projectId, user);
    if (member.rank !== "owner")
      throw new ForbiddenError(
        "Automation diagnostics require the project owner",
      );
  }

  public async assertMutation(
    rule: Automation,
    user: UserAccountToken,
    action: "edit" | "enable" | "disable" | "delete",
  ): Promise<void> {
    if (rule.authorUserId === user.id) {
      await this.assert(rule.projectId, user, "automation:write");
      return;
    }
    if (action !== "disable" && action !== "delete")
      throw new ForbiddenError(
        "Only the immutable author can edit or enable this automation",
      );
    await this.assert(rule.projectId, user, "automation:manage");
  }

  /**
   * Resolve only identifiers, roles and scope. Key hashes, prefixes, suffixes,
   * contact details and secrets never enter the execution identity.
   */
  public async author(
    rule: Pick<Automation, "authorUserId" | "authorKeyId">,
  ): Promise<UserAccountToken> {
    const account = await this.users.findById(rule.authorUserId);
    if (!account?.enabled)
      throw new ForbiddenError("Automation author account is unavailable");
    let roles = account.roles;
    let permissionScope: string[] | undefined;
    if (rule.authorKeyId) {
      const [key] = await this.keys.findMany({
        where: { id: rule.authorKeyId, userId: account.id },
        columns: ["id", "roles", "permissions", "revokedAt", "expiresAt"],
        limit: 1,
      });
      if (!key) throw new ForbiddenError("Authoring API key no longer exists");
      if (key.revokedAt)
        throw new ForbiddenError("Authoring API key is revoked");
      if (
        key.expiresAt &&
        new Date(key.expiresAt).getTime() <= this.dateTime.nowMillis()
      )
        throw new ForbiddenError("Authoring API key is expired");
      roles = roles.filter((role) => key.roles.includes(role));
      permissionScope = key.permissions.length ? key.permissions : undefined;
    }
    return {
      id: account.id,
      roles,
      realm: account.realm,
      ownership: true,
      ...(permissionScope ? { permissionScope } : {}),
      ...(rule.authorKeyId
        ? { credential: { type: "api-key", id: rule.authorKeyId } as const }
        : {}),
    };
  }

  public async provenance(user: UserAccountToken): Promise<string | undefined> {
    if (!user.credential) return undefined;
    if (user.credential.type !== "api-key")
      throw new ForbiddenError(
        "Author automations from a signed-in session or an API key with a revocable identity",
      );
    await this.author({
      authorUserId: user.id,
      authorKeyId: user.credential.id,
    });
    return user.credential.id;
  }

  protected async membership(projectId: number, user: UserAccountToken) {
    const project = await this.security.projects.getById(projectId);
    const member = await this.security.members.findOne({
      where: { organizationId: project.organizationId!, userId: user.id },
    });
    if (!member)
      throw new ForbiddenError("Not a current member of this project");
    return { project, member };
  }
}
