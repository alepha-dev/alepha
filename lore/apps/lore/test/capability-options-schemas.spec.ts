import { CapabilityRegistry } from "@lore/core/schemas";
import { appsCapabilityOptionsSchema } from "@lore/deploy/schemas";
import { knowledgeCapabilityOptionsSchema } from "@lore/knowledge/schemas";
import {
  supportCapabilityOptionsSchema,
  workCapabilityOptionsSchema,
} from "@lore/work/schemas";
import { describe, it } from "vitest";

/**
 * Core derives each capability's options schema from the options it declares
 * (#E75, #Q2623): it may not import the module that owns the capability. Each
 * module keeps its own schema for its typed reads. This holds the two equal,
 * so an option added on one side and not the other is a red test rather than
 * a key that one side strips.
 */
describe("capability options schemas", () => {
  const registry = new CapabilityRegistry();
  const owned = {
    work: workCapabilityOptionsSchema,
    knowledge: knowledgeCapabilityOptionsSchema,
    apps: appsCapabilityOptionsSchema,
    support: supportCapabilityOptionsSchema,
  };

  it("reads the same keys, all false when absent, as each module's schema", ({
    expect,
  }) => {
    for (const [key, schema] of Object.entries(owned)) {
      expect(
        registry.optionsOf(key as keyof typeof owned, {}),
        `${key} options`,
      ).toEqual(schema.parse({}));
    }
  });

  it("strips a key the build does not know and keeps the known ones", ({
    expect,
  }) => {
    expect(registry.optionsOf("work", { epics: true, retired: true })).toEqual(
      workCapabilityOptionsSchema.parse({ epics: true }),
    );
  });
});
