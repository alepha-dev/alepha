import { ProjectPermissions, ProjectSecurityService } from "@lore/core/api";
import type { CapabilityKey } from "@lore/core/schemas";
import { CapabilityRegistry } from "@lore/core/schemas";
import { $inject } from "alepha";
import type { AiPageContext } from "alepha/ai";
import type { UserAccountToken } from "alepha/security";

import { LoreAiContext } from "./LoreAiContext.ts";
import { type LoreAiTool, LoreAiToolset } from "./LoreAiToolset.ts";

/**
 * Which tools a user is offered on a turn: `$ai`'s `allow` (#Q3208, #Q3209).
 *
 * Inside a project, a tool is offered when the user's EFFECTIVE permissions
 * there (`ProjectPermissions`: application AND rank AND capability) hold
 * every permission the table lists for it, and the capability owning it
 * (`CapabilityRegistry.ownerOfTool`) is on. A user who is not a member is
 * offered nothing project-scoped. Off a project page only `project_list` is
 * offered, and the prompt says to ask which project.
 *
 * It decides what the model sees, not what may run: every tool still runs
 * its action's own gate as the turn's user.
 */
export class LoreAiToolAccess {
  protected readonly toolset = $inject(LoreAiToolset);
  protected readonly context = $inject(LoreAiContext);
  protected readonly permissions = $inject(ProjectPermissions);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly capabilities = $inject(CapabilityRegistry);

  /**
   * The tool names offered to `user` on a turn sent with `context`.
   */
  public async offered(ctx: {
    user?: UserAccountToken;
    context?: AiPageContext;
  }): Promise<string[]> {
    const projectId = this.context.projectIdOf(ctx.context);
    if (projectId === undefined || !ctx.user) {
      return this.toolset.offProject.map((entry) => this.toolset.nameOf(entry));
    }
    return (await this.inProject(projectId, ctx.user)).map((entry) =>
      this.toolset.nameOf(entry),
    );
  }

  /**
   * The project-scoped tools `user` may be offered in `projectId`, in the
   * table's order.
   */
  public async inProject(
    projectId: number,
    user: UserAccountToken,
  ): Promise<LoreAiTool[]> {
    const granted = await this.grantedIn(projectId, user);
    if (!granted) {
      return [];
    }
    const enabled = Object.keys(
      await this.security.capabilitiesOf(projectId),
    ) as CapabilityKey[];
    return this.toolset.projectScoped.filter(
      (entry) =>
        entry.permissions.every((permission) => granted.has(permission)) &&
        this.capabilities.isOwnerEnabled(
          this.capabilities.ownerOfTool(this.toolset.nameOf(entry)),
          enabled,
        ),
    );
  }

  /**
   * The user's effective permissions in the project, or `undefined` when
   * they hold no membership there (or the project does not exist): the
   * model is then offered nothing about it, as the tools' own gates would
   * refuse it all.
   */
  protected async grantedIn(
    projectId: number,
    user: UserAccountToken,
  ): Promise<Set<string> | undefined> {
    try {
      const organizationId = await this.security.organizationIdOf(projectId);
      const member = await this.security.members.findOne({
        where: {
          organizationId: { eq: organizationId },
          userId: { eq: user.id },
        },
      });
      if (!member) {
        return undefined;
      }
      const { permissions } = await this.permissions.of(
        projectId,
        user,
        member,
      );
      return new Set(permissions);
    } catch {
      // An unknown project id, from a stale or hand-made page context.
      return undefined;
    }
  }
}
