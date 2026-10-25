import { $inject } from "alepha";
import {
  type ResourceGrantsDecision,
  ResourceGrantsProvider,
  type ResourceGrantsRequest,
} from "alepha/security";

import { RankService } from "../services/RankService.ts";

export class RankGrantsProvider extends ResourceGrantsProvider {
  protected readonly ranks = $inject(RankService);

  public override async check(
    request: ResourceGrantsRequest,
  ): Promise<ResourceGrantsDecision> {
    const organizationId = request.membership?.organizationId;
    if (
      typeof organizationId !== "string" ||
      request.user.ownership === false
    ) {
      return { allowed: true };
    }
    const rows = {
      authority: request.authority,
      membership: request.membership,
      user: request.user,
    };
    const resolved = await this.ranks.resolve(rows);
    if (!resolved) return { allowed: true };
    const missing = request.requires.filter(
      (permission) => !this.ranks.grants(resolved.permissions, permission),
    );
    if (missing.length === 0) return { allowed: true };
    return {
      allowed: false,
      message: await this.ranks.refusal(
        {
          organizationId,
          rank:
            resolved.key && resolved.name
              ? { key: resolved.key, name: resolved.name }
              : undefined,
          missing,
          user: request.user,
        },
        rows,
      ),
    };
  }
}
