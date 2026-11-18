import { $inject, AlephaError } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError } from "alepha/server";

import type { AutomationGraphValue } from "../schemas/automationGraphSchema.ts";
import {
  automationPresetCreateSchema,
  type AutomationPresetCreate,
} from "../schemas/automationPresetCreateSchema.ts";
import type { AutomationPresetDraft } from "../schemas/automationPresetDraftSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationPresetRegistry } from "./AutomationPresetRegistry.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * Presets only construct stock ASTs; normal authoring owns every validation,
 * immutable credential, approval fence and the draft-or-enabled write.
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
    options: { subscription?: boolean; subscriptionScope?: string } = {},
  ) {
    await this.access.assert(projectId, user, "automation:write", {
      subscription: options.subscription,
    });
    const body = automationPresetCreateSchema.parse(input);
    const { values, shared } = await this.resolve(projectId, user, body);
    let built: ReturnType<AutomationPresetRegistry["build"]>;
    try {
      built = this.presets.build(body.key, values, shared);
    } catch (error) {
      if (error instanceof AlephaError)
        throw new BadRequestError(error.message);
      throw error;
    }
    return this.write(projectId, user, body, built, options);
  }

  /**
   * Several presets as one automation (#Q3808): what a bell makes. Each
   * preset contributes its own nodes, prefixed with its key; `edit` adjusts
   * the merged graph (the channels, which sources are on) before it is
   * written.
   */
  public async createMerged(
    projectId: number,
    user: UserAccountToken,
    input: {
      keys: string[];
      key: string;
      values: Record<string, string>;
      title?: string;
      enabled?: boolean;
      edit?: (rule: AutomationGraphValue) => AutomationGraphValue;
    },
    options: { subscription?: boolean; subscriptionScope?: string } = {},
  ) {
    await this.access.assert(projectId, user, "automation:write", {
      subscription: options.subscription,
    });
    let built: ReturnType<AutomationPresetRegistry["merge"]>;
    try {
      built = this.presets.merge(
        input.keys.map((key) => ({ key, values: input.values })),
      );
    } catch (error) {
      if (error instanceof AlephaError)
        throw new BadRequestError(error.message);
      throw error;
    }
    return this.service.create(
      projectId,
      user,
      {
        title: input.title ?? built.descriptors[0].title,
        rule: input.edit ? input.edit(built.rule) : built.rule,
        enabled: input.enabled,
      },
      options.subscription
        ? {
            key: input.key,
            subscription: true,
            subscriptionScope: options.subscriptionScope ?? "",
          }
        : input.key,
    );
  }

  /**
   * A preset's graph, built from the values and bindings a create takes and
   * stored nowhere (#Q3812): what Open in editor opens, and what Add from a
   * preset merges into a draft, its node ids under `prefix`.
   */
  public async draft(
    projectId: number,
    user: UserAccountToken,
    input: Omit<AutomationPresetCreate, "enabled"> & { prefix?: string },
  ): Promise<AutomationPresetDraft> {
    await this.access.assert(projectId, user, "automation:write");
    const { prefix, ...rest } = input;
    const body = automationPresetCreateSchema.parse(rest);
    const { values, shared } = await this.resolve(projectId, user, body);
    try {
      if (prefix) {
        const merged = this.presets.merge([
          { key: body.key, values, shared, prefix },
        ]);
        return {
          title: body.title ?? merged.descriptors[0].title,
          rule: merged.rule,
        };
      }
      const built = this.presets.build(body.key, values, shared);
      return {
        title: body.title ?? built.descriptor.title,
        rule: built.rule,
      };
    } catch (error) {
      if (error instanceof AlephaError)
        throw new BadRequestError(error.message);
      throw error;
    }
  }

  /**
   * The values a preset is built from: the literal ones, and each shared
   * binding checked against the variable as it is now.
   */
  protected async resolve(
    projectId: number,
    user: UserAccountToken,
    body: ReturnType<typeof automationPresetCreateSchema.parse>,
  ) {
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
    return { values, shared };
  }

  protected write(
    projectId: number,
    user: UserAccountToken,
    body: ReturnType<typeof automationPresetCreateSchema.parse>,
    built: ReturnType<AutomationPresetRegistry["build"]>,
    options: { subscription?: boolean; subscriptionScope?: string },
  ) {
    const { descriptor: preset, rule } = built;
    return this.service.create(
      projectId,
      user,
      { title: body.title ?? preset.title, rule, enabled: body.enabled },
      options.subscription
        ? {
            key: preset.key,
            subscription: true,
            subscriptionScope: options.subscriptionScope ?? "",
          }
        : preset.key,
      Object.values(body.bindings ?? {}),
    );
  }
}
