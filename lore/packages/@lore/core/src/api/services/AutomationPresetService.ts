import { $inject, AlephaError } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError } from "alepha/server";

import {
  automationPresetCreateSchema,
  type AutomationPresetCreate,
} from "../schemas/automationPresetCreateSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationPresetRegistry } from "./AutomationPresetRegistry.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * Presets only construct stock ASTs; normal authoring owns every validation,
 * immutable credential, approval fence and disabled-by-default write.
 */
export class AutomationPresetService {
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly catalog = $inject(AutomationCatalog);
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
    const values = { ...body.values };
    const shared: Record<string, string> = {};
    const descriptor = this.presets
      .all()
      .find((preset) => preset.key === body.key);
    for (const [name, expected] of Object.entries(body.bindings ?? {})) {
      const slot = descriptor?.slots[name];
      if (!slot?.bindable)
        throw new BadRequestError(
          `setup.${name}: shared binding is unavailable`,
        );
      const variable = await this.persistence.variables.findOne({
        where: { projectId, id: expected.id, key: expected.key },
      });
      if (!variable || variable.version !== expected.version)
        throw new ConflictError(
          `setup.${name}: shared variable changed; reload before creating`,
        );
      const inspected = await this.catalog.inspectVariable(
        projectId,
        user,
        variable,
      );
      if (!inspected.available)
        throw new BadRequestError(
          `setup.${name}: shared variable is unavailable`,
        );
      if (slot.kind !== variable.value.kind)
        throw new BadRequestError(
          `setup.${name}: expected a '${slot.kind}' variable`,
        );
      values[name] = variable.value.value;
      shared[name] = variable.key;
    }
    let built: ReturnType<AutomationPresetRegistry["build"]>;
    try {
      built = this.presets.build(body.key, values, shared);
    } catch (error) {
      if (error instanceof AlephaError)
        throw new BadRequestError(error.message);
      throw error;
    }
    const { descriptor: preset, rule } = built;
    return this.service.create(
      projectId,
      user,
      { title: body.title ?? preset.title, rule },
      preset.key,
      Object.values(body.bindings ?? {}),
    );
  }
}
