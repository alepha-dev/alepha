import { $inject } from "alepha";
import type { AiPageContext } from "alepha/ai";
import type { UserAccountToken } from "alepha/security";

import { LoreAiContext } from "./LoreAiContext.ts";
import { LoreAiToolset } from "./LoreAiToolset.ts";

/**
 * Which tools a user is offered on a turn: `$ai`'s `allow` (#Q3208, #Q3209).
 *
 * It decides what the model sees, not what may run: every tool still runs
 * its action's own gate as the turn's user. Off a project page only
 * `project_list` is offered, and the prompt says to ask which project.
 */
export class LoreAiToolAccess {
  protected readonly toolset = $inject(LoreAiToolset);
  protected readonly context = $inject(LoreAiContext);

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
    return this.inProject(projectId, ctx.user);
  }

  /**
   * The project-scoped tools `user` may be offered in `projectId`.
   */
  protected async inProject(
    _projectId: number,
    _user: UserAccountToken,
  ): Promise<string[]> {
    return [];
  }
}
