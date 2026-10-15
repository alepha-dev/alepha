import { $inject, AlephaError } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import {
  automationPresetCreateSchema,
  type AutomationPresetCreate,
} from "../schemas/automationPresetCreateSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationPresetRegistry } from "./AutomationPresetRegistry.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * Presets only construct stock ASTs; normal authoring owns every validation,
 * immutable credential, approval fence and disabled-by-default write.
 */
export class AutomationPresetService {
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly service = $inject(AutomationService);
  protected readonly access = $inject(AutomationAccess);
  public async create(
    projectId: number,
    user: UserAccountToken,
    input: AutomationPresetCreate,
  ) {
    await this.access.assert(projectId, user, "automation:write");
    const body = automationPresetCreateSchema.parse(input);
    let built: ReturnType<AutomationPresetRegistry["build"]>;
    try {
      built = this.presets.build(body.key, body.values);
    } catch (error) {
      if (error instanceof AlephaError)
        throw new BadRequestError(error.message);
      throw error;
    }
    const { descriptor, rule } = built;
    return this.service.create(
      projectId,
      user,
      { title: body.title ?? descriptor.title, rule },
      descriptor.key,
    );
  }
}
