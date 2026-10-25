import { AlephaError } from "alepha";

export interface DurableObjectBinding {
  name: string;
  class_name?: string;
  script_name?: string;
  environment?: string;
  namespace_id?: string;
  dispatch_namespace?: string;
  retry?: { max_attempts?: number; timeout_ms?: number };
}

export interface DurableObjectLifecycleConfig {
  durable_objects?: { bindings?: DurableObjectBinding[] };
  exports?: Record<string, Record<string, unknown>>;
  migrations?: Array<Record<string, unknown>>;
}

/**
 * Translate explicit Durable Object lifecycle configuration for API uploads.
 * Missing declarations never imply deletion, renaming or namespace transfer.
 */
export class DurableObjectLifecycle {
  public validate(config: DurableObjectLifecycleConfig): void {
    if (
      config.migrations !== undefined &&
      Object.values(config.exports ?? {}).some(
        (entry) => entry.type === "durable-object",
      )
    )
      throw new AlephaError(
        "Durable Object exports and migrations are mutually exclusive",
      );
    if (config.migrations !== undefined) {
      if (!Array.isArray(config.migrations))
        throw new AlephaError(
          "Durable Object migrations must be an ordered array",
        );
      const tags = new Set<string>();
      for (const step of config.migrations) {
        if (typeof step.tag !== "string" || !step.tag || tags.has(step.tag))
          throw new AlephaError(
            "Durable Object migration tags must be nonempty and unique",
          );
        tags.add(step.tag);
      }
    }
  }

  public bindings(
    config: DurableObjectLifecycleConfig,
  ): Array<Record<string, unknown>> {
    const names = new Set<string>();
    return (config.durable_objects?.bindings ?? []).map((binding) => {
      if (
        !binding.name ||
        names.has(binding.name) ||
        (!binding.class_name && !binding.namespace_id)
      )
        throw new AlephaError("Invalid or duplicate Durable Object binding");
      names.add(binding.name);
      const result: Record<string, unknown> = {
        type: "durable_object_namespace",
        name: binding.name,
      };
      for (const field of [
        "class_name",
        "script_name",
        "environment",
        "namespace_id",
        "dispatch_namespace",
        "retry",
      ] as const)
        if (binding[field] !== undefined) result[field] = binding[field];
      return result;
    });
  }

  public migrations(
    config: DurableObjectLifecycleConfig,
    deployedTag?: string,
  ): Record<string, unknown> | undefined {
    this.validate(config);
    const history = config.migrations ?? [];
    if (!history.length) {
      if (deployedTag)
        throw new AlephaError(
          `Deployed Durable Object migration tag '${deployedTag}' is missing from the supplied history`,
        );
      return undefined;
    }
    const index =
      deployedTag === undefined
        ? -1
        : history.findIndex((step) => step.tag === deployedTag);
    if (deployedTag !== undefined && index === -1)
      throw new AlephaError(
        `Deployed Durable Object migration tag '${deployedTag}' is missing from the supplied history`,
      );
    if (index === history.length - 1) return undefined;
    return {
      ...(deployedTag === undefined ? {} : { old_tag: deployedTag }),
      new_tag: history.at(-1)!.tag,
      steps: history.slice(index + 1).map(({ tag: _tag, ...step }) => step),
    };
  }
}
