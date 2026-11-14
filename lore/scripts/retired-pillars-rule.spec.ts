import { describe, it } from "vitest";

import { RetiredPillarsRule } from "./retired-pillars-rule.ts";

const rule = new RetiredPillarsRule();

describe("RetiredPillarsRule", () => {
  it("refuses the old package and module names", ({ expect }) => {
    const found = rule.check(
      "lore/apps/lore/src/main.server.ts",
      [
        'import { QuestService } from "@lore/work/api";',
        'import { FolioService } from "@lore/knowledge/api";',
        'export * from "@lore/deploy/web";',
        "alepha.with(LoreWorkApi).with(LoreKnowledgeMcp).with(LoreDeployWeb);",
        'const key = "lore.deploy.api:DeployController";',
      ].join("\n"),
    );

    expect(found).toHaveLength(5);
    expect(found[0]).toMatch(/main\.server\.ts:1: /);
  });

  it("refuses an old capability key where a capability is meant", ({
    expect,
  }) => {
    const found = rule.check(
      "lore/apps/e2e/web/thing.spec.ts",
      [
        'needs: [{ capability: "support" }],',
        'if (hasCapability(project, "work")) return;',
        'await setCapability(page, project.id, "apps", { enabled: true });',
        '{ key: "knowledge" },',
        '{ key: "apps", options: { track: true } },',
        'res.url().includes("/capabilities/apps"),',
        'tr("project.capability.support.label")',
        "lore project capability enable apps --option deploy",
      ].join("\n"),
    );

    expect(found).toHaveLength(8);
  });

  it("leaves the feature words and routes that stay", ({ expect }) => {
    expect(
      rule.check(
        "lore/packages/@lore/ship/src/web/app/DeployRouter.ts",
        [
          'import { DeployLimits } from "./DeployLimits.ts";',
          'const atom = "lore.deploy.limits";',
          'requires: "deploy:manage",',
          'path: "/apps",',
          'name: "apps",',
          '{ slot: "apps", rank: 1 },',
          'import { LoreShipApi } from "@lore/ship/api";',
          'needs: { capability: "plan", option: "feedback" },',
          'import { Workflow } from "lucide-react";',
          'const key = "@lore/workbench";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("lets history and the migration specs say anything", ({ expect }) => {
    for (const file of [
      "lore/apps/lore/migrations/sqlite/20261114101109_pillar_capability_keys/migration.sql",
      "lore/apps/lore/test/pillar-capability-keys-migration.spec.ts",
      "lore/apps/lore/test/feedback-into-plan-migration.spec.ts",
    ]) {
      expect(
        rule.check(file, 'capability: "support", key: "work" @lore/work'),
        file,
      ).toEqual([]);
    }
  });
});
