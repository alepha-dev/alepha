import { $inject, type Infer } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { automationSetupQuerySchema } from "../schemas/automationSetupQuerySchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationReferences } from "./AutomationReferences.ts";

/**
 * Feature-owned, bounded project pickers use the caller's current key ceiling.
 * No feature table crosses the package boundary and no document body is read.
 */
export class AutomationSetupOptions {
  protected readonly access = $inject(AutomationAccess);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly references = $inject(AutomationReferences);
  public async list(
    projectId: number,
    user: UserAccountToken,
    input: Infer<typeof automationSetupQuerySchema>,
  ) {
    return this.database.primary(async () => {
      const query = automationSetupQuerySchema.parse(input);
      const context = await this.access.authorize(
        projectId,
        user,
        "automation:read",
      );
      const provider = this.references.options(query.kind);
      if (!provider)
        throw new BadRequestError(
          `Setup options '${query.kind}' are unavailable`,
        );
      if (!context.permissions.includes(provider.permission))
        throw new ForbiddenError(`Missing ${provider.permission}`);
      const result = await provider.read({
        projectId,
        offset: query.offset,
        limit: query.limit,
      });
      return {
        ...result,
        ...(result.hasMore ? { nextOffset: query.offset + query.limit } : {}),
      };
    });
  }
}
