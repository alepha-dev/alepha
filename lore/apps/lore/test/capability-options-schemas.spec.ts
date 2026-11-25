import { chatCapabilityOptionsSchema } from "@lore/chat/schemas";
import { CapabilityRegistry } from "@lore/core/schemas";
import { planCapabilityOptionsSchema } from "@lore/plan/schemas";
import { promptsCapabilityOptionsSchema } from "@lore/prompts/schemas";
import { rememberCapabilityOptionsSchema } from "@lore/remember/schemas";
import { shipCapabilityOptionsSchema } from "@lore/ship/schemas";
import { z } from "alepha";
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
    plan: planCapabilityOptionsSchema,
    remember: rememberCapabilityOptionsSchema,
    ship: shipCapabilityOptionsSchema,
    chat: chatCapabilityOptionsSchema,
    prompts: promptsCapabilityOptionsSchema,
    // Core's own switches (#Q4007), with no module. Reports holds Quality
    // since Build went (#Q4217).
    activity: z.object({}),
    reports: z.object({ quality: z.boolean().default(false) }),
  };

  it("has a module schema for every capability", ({ expect }) => {
    expect(Object.keys(owned).sort()).toEqual([...registry.keys()].sort());
  });

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
    expect(registry.optionsOf("plan", { epics: true, retired: true })).toEqual(
      planCapabilityOptionsSchema.parse({ epics: true }),
    );
  });
});
