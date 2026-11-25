import { JobKeyService } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import type { UserAccountToken } from "alepha/security";

/**
 * The agent job a quest write comes from (#Q4350): the job whose key made
 * the current request, read from the key itself, so no prompt change and no
 * tool parameter is needed. A member's own request answers nothing.
 */
export class QuestJobStamp {
  protected readonly alepha = $inject(Alepha);

  /**
   * The id of the agent job whose key made the current request, if one did.
   */
  public async callerJob(): Promise<string | undefined> {
    const request = this.alepha.store.get("alepha.http.request") as
      | { user?: UserAccountToken }
      | undefined;
    if (!request?.user) return undefined;
    // Resolved where it is used: the key service reaches the MCP scope,
    // which a quest write outside MCP never loads.
    const key = await this.alepha
      .inject(JobKeyService)
      .scopeOf(request.user)
      .catch(() => undefined);
    return key?.jobId;
  }
}
