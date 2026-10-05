import { describe, it } from "vitest";

import { LorePackageGraph } from "./lore-package-graph.ts";

const exports = {
  core: ["api", "mcp", "web", "schemas", "testing"],
  work: ["api", "mcp", "web", "schemas"],
  knowledge: ["api", "mcp", "web", "schemas"],
  deploy: ["api", "mcp", "web", "schemas"],
};

const graph = new LorePackageGraph(exports);

describe("LorePackageGraph", () => {
  it("allows a feature module to import core", ({ expect }) => {
    const source = [
      'import { LoreCoreApi } from "@lore/core/api";',
      'import { projectFixture } from "@lore/core/testing";',
      'import { Thing } from "./services/Thing.ts";',
    ].join("\n");

    expect(graph.check("packages/@lore/work/src/api/index.ts", source)).toEqual(
      [],
    );
  });

  it("refuses a feature module importing another, naming the file, the import and the edge", ({
    expect,
  }) => {
    const violations = graph.check(
      "packages/@lore/knowledge/src/api/services/FolioService.ts",
      'import { QuestService } from "@lore/work/api";',
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(
      "packages/@lore/knowledge/src/api/services/FolioService.ts",
    );
    expect(violations[0]).toContain('"@lore/work/api"');
    expect(violations[0]).toContain("@lore/knowledge -> @lore/work");
  });

  it("refuses core importing a feature module", ({ expect }) => {
    expect(
      graph.check(
        "packages/@lore/core/src/api/index.ts",
        'export { LoreWorkApi } from "@lore/work/api";',
      ),
    ).toHaveLength(1);
  });

  it("refuses a runtime import of another package's ./api from ./web", ({
    expect,
  }) => {
    const violations = graph.check(
      "packages/@lore/work/src/web/QuestPage.tsx",
      'import { ProjectController } from "@lore/core/api";',
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("import type");
  });

  it("allows a type-only import of another package's ./api from ./web", ({
    expect,
  }) => {
    const source = [
      'import type { ProjectController } from "@lore/core/api";',
      'import { type ProjectMcp, type Other } from "@lore/core/mcp";',
      'import { projectSchema } from "@lore/core/schemas";',
      'import { LoreCoreWeb } from "@lore/core/web";',
    ].join("\n");

    expect(
      graph.check("packages/@lore/work/src/web/QuestPage.tsx", source),
    ).toEqual([]);
  });

  it("refuses a deep import past a package's exports", ({ expect }) => {
    expect(
      graph.check(
        "packages/@lore/deploy/src/api/AppService.ts",
        'import { ProjectService } from "@lore/core/src/api/services/ProjectService.ts";',
      ),
    ).toHaveLength(1);
  });

  it("refuses an import of the app, by name or by path, and `@/`", ({
    expect,
  }) => {
    const source = [
      'import type { QuestController } from "lore/api/controllers/QuestController";',
      'import { LoreApi } from "../../../../../apps/lore/src/api/index.ts";',
      'import { I18n } from "@/web/app/services/I18n.ts";',
      'const lazy = () => import("../../../work/src/web/index.ts");',
    ].join("\n");

    expect(
      graph.check("packages/@lore/core/src/web/index.ts", source),
    ).toHaveLength(4);
  });

  it("ignores files outside packages/@lore", ({ expect }) => {
    expect(
      graph.check(
        "apps/lore/src/main.server.ts",
        'import { LoreWorkApi } from "@lore/work/api";',
      ),
    ).toEqual([]);
  });
});
