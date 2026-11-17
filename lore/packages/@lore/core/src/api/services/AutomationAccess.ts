import { $inject } from "alepha";
import { apiKeyEntity } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import {
  EffectivePermissionsProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { users } from "../entities/users.ts";
import { AutomationProjectPermissions } from "../security/AutomationProjectPermissions.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationOAuthAuthority } from "./AutomationOAuthAuthority.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";

/**
 * Shared normal-authoring gate. Execution additionally reconstructs the live
 * author's key ceiling before every effect; it never uses the job's token.
 */
export class AutomationAccess {
  protected readonly effective = $inject(EffectivePermissionsProvider);
  protected readonly applicationSecurity = $inject(SecurityProvider);
  protected readonly oauth = $inject(AutomationOAuthAuthority);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly permissions = $inject(AutomationProjectPermissions);

  protected readonly users = $repository(users);
  protected readonly keys = $repository(apiKeyEntity);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async assert(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
    subject?: AutomationAccessSubject,
  ): Promise<void> {
    await this.authorize(projectId, user, permission, subject);
  }

  public async authorize(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
    subject?: AutomationAccessSubject,
  ) {
    return this.database.primary(() =>
      this.authorizePrimary(projectId, user, permission, subject),
    );
  }

  /**
   * Whether this check is a member's own subscription (#Q3648): a rule a
   * subscription toggle created, authored by the caller, which notifies the
   * caller only (`AutomationSubscriptionService` writes no other kind). A
   * member who may not author automations, a Viewer among them, may still read, keep, switch off and remove their own.
   *
   * Never `automation:manage`, and never an edit: an edited rule is no
   * longer the preset the toggle made, so editing one asks for
   * `automation:write` like any rule. What the subscription may watch is
   * still gated by the catalog, on the source's own read permission.
   */
  public isSelfSubscription(
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
    subject?: AutomationAccessSubject,
  ): boolean {
    return (
      subject?.subscription === true &&
      permission !== "automation:manage" &&
      (subject.authorUserId === undefined || subject.authorUserId === user.id)
    );
  }

  protected async authorizePrimary(
    projectId: number,
    user: UserAccountToken,
    permission: "automation:read" | "automation:write" | "automation:manage",
    subject?: AutomationAccessSubject,
  ) {
    const current = await this.currentUser(user);
    const { project, member } = await this.membership(projectId, current);
    const allowed = await this.permissions.of(
      projectId,
      { ...current, ownership: true },
      member,
    );
    const required = this.isSelfSubscription(user, permission, subject)
      ? "project:read"
      : permission;
    if (!allowed.permissions.includes(required))
      throw new ForbiddenError(`Missing ${permission}`);
    // No capability since #Q3629: automations are Core, and the catalog
    // gates each event, selector and preset by its own needs.
    return {
      project,
      member,
      // A self-subscription notifies its author and nobody else
      // (`AutomationSubscriptionService` forces the recipient, and an edit
      // is refused without automation:write), so the one recipient it names
      // needs no `member:read`: that permission is for choosing others.
      permissions: this.isSelfSubscription(user, permission, subject)
        ? [...new Set([...allowed.permissions, "member:read"])]
        : allowed.permissions,
      capabilities: await this.security.capabilitiesOf(projectId),
    };
  }

  public async assertMutation(
    rule: Automation,
    user: UserAccountToken,
    action: "edit" | "enable" | "disable" | "delete",
  ): Promise<void> {
    if (rule.authorUserId === user.id) {
      await this.assert(
        rule.projectId,
        user,
        "automation:write",
        action === "edit" ? undefined : rule,
      );
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
    rule: Pick<Automation, "authorUserId" | "authorKeyId"> &
      Partial<Pick<Automation, "authorSessionId" | "authorScope">>,
  ): Promise<UserAccountToken> {
    return this.database.primary(() => this.authorPrimary(rule));
  }

  protected async authorPrimary(
    rule: Pick<Automation, "authorUserId" | "authorKeyId"> &
      Partial<Pick<Automation, "authorSessionId" | "authorScope">>,
  ): Promise<UserAccountToken> {
    const account = await this.users.findById(rule.authorUserId);
    if (!account?.enabled)
      throw new ForbiddenError("Automation author account is unavailable");
    if (rule.authorKeyId && rule.authorSessionId)
      throw new ForbiddenError("Ambiguous authoring credential");
    if (rule.authorSessionId)
      return this.oauth.resolve({
        id: rule.authorSessionId,
        userId: account.id,
        roles: account.roles,
        realm: account.realm,
        originalScope: rule.authorScope,
      });
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

  public async provenance(
    user: UserAccountToken,
  ): Promise<
    | Partial<
        Pick<Automation, "authorKeyId" | "authorSessionId" | "authorScope">
      >
    | undefined
  > {
    if (!user.credential) return undefined;
    if (user.credential.type === "api-key") {
      await this.author({
        authorUserId: user.id,
        authorKeyId: user.credential.id,
      });
      return { authorKeyId: user.credential.id };
    }
    if (!user.sessionId)
      throw new ForbiddenError(
        "OAuth authoring requires a revocable session identity",
      );
    const grant = await this.oauth.resolve({
      id: user.sessionId,
      userId: user.id,
      roles: user.roles ?? [],
      realm: user.realm,
      clientId: user.credential.clientId,
      originalScope: user.permissionScope,
    });
    return {
      authorSessionId: user.sessionId,
      authorScope: grant.permissionScope,
    };
  }

  protected async currentUser(
    user: UserAccountToken,
  ): Promise<UserAccountToken> {
    const account = await this.users.findById(user.id);
    if (!account?.enabled)
      throw new ForbiddenError("Automation caller account is unavailable");
    let current: UserAccountToken;
    if (user.credential?.type === "api-key")
      current = await this.author({
        authorUserId: user.id,
        authorKeyId: user.credential.id,
      });
    else if (user.credential?.type === "oauth") {
      if (!user.sessionId)
        throw new ForbiddenError(
          "OAuth automation access requires a revocable session identity",
        );
      current = await this.oauth.resolve({
        id: user.sessionId,
        userId: account.id,
        roles: account.roles,
        realm: account.realm,
        clientId: user.credential.clientId,
        originalScope: user.permissionScope,
      });
    } else current = { ...user, roles: account.roles, ownership: true };
    current.roles = current.roles?.filter((role) => user.roles?.includes(role));
    return {
      ...current,
      permissionScope: this.effective.resolve({
        user: current,
        narrow: [
          (permission) =>
            this.applicationSecurity.isInPermissionScope(
              permission,
              user.permissionScope,
            ),
        ],
      }),
    };
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

/**
 * What an authoring check is about, when it is about a rule: whether it is
 * a subscription, and whose (see `AutomationAccess.isSelfSubscription`).
 */
export interface AutomationAccessSubject {
  subscription?: boolean;
  authorUserId?: string;
}
