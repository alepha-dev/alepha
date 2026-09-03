import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { WorkspaceGraph } from "../services/WorkspaceGraph.ts";

/**
 * `yarn workspaces list -v --json` emits one JSON object per line.
 */
const yarnOutput = (
  rows: Array<{
    name: string;
    location: string;
    workspaceDependencies?: string[];
  }>,
) => rows.map((row) => JSON.stringify(row)).join("\n");

describe("WorkspaceGraph", () => {
  const createTestEnv = (rows: Parameters<typeof yarnOutput>[0]) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with({
      provide: ShellProvider,
      use: MemoryShellProvider,
    });

    const shell = alepha.inject(MemoryShellProvider);
    shell.outputs.set("yarn workspaces list -v --json", yarnOutput(rows));

    return { shell, graph: alepha.inject(WorkspaceGraph) };
  };

  /**
   * The shape of this repository, reduced to what the graph cares about:
   * a root workspace, the framework everything depends on, a package, and two
   * apps, one of which forms a cycle with a package.
   */
  const repo = [
    { name: "alepha-monorepo", location: ".", workspaceDependencies: [] },
    { name: "alepha", location: "packages/alepha", workspaceDependencies: [] },
    {
      name: "@alepha/ui",
      location: "packages/@alepha/ui",
      workspaceDependencies: ["packages/alepha"],
    },
    {
      name: "@alepha/lore",
      location: "packages/@alepha/lore",
      workspaceDependencies: ["packages/alepha", "apps/lore"],
    },
    {
      name: "lore",
      location: "apps/lore",
      workspaceDependencies: [
        "packages/alepha",
        "packages/@alepha/ui",
        "packages/@alepha/lore",
      ],
    },
    {
      name: "docs",
      location: "apps/docs",
      workspaceDependencies: ["packages/alepha"],
    },
  ];

  describe("read", () => {
    it("should map yarn's locations onto workspace names", async () => {
      const { graph } = createTestEnv(repo);

      const workspaces = await graph.read();
      const ui = workspaces.find((it) => it.name === "@alepha/ui");

      expect(ui?.location).toBe("packages/@alepha/ui");
      expect(ui?.dependencies).toEqual(["alepha"]);
    });

    /**
     * `ShellRunOptions` names the working directory `root`, not `cwd`, and
     * `MemoryShellProvider` records whatever it is handed without validating
     * it. So a wrong key here passes every behavioural test above and lists
     * the workspaces of whatever directory the process happened to start in.
     */
    it("should run the listing in the requested directory", async () => {
      const { shell, graph } = createTestEnv(repo);

      await graph.read("/somewhere/else");

      expect(shell.calls[0].options.root).toBe("/somewhere/else");
    });
  });

  describe("ownerOf", () => {
    it("should pick the longest matching location", async () => {
      const { graph } = createTestEnv(repo);
      const workspaces = await graph.read();

      const owner = graph.ownerOf(workspaces, "apps/lore/src/web/App.tsx");

      expect(owner?.name).toBe("lore");
    });

    /**
     * The root workspace's location is `.`, which prefixes every path in the
     * repository. Without the longest-match rule it would own everything and
     * no other workspace would ever be selected.
     */
    it("should give a repo-level file to the root workspace", async () => {
      const { graph } = createTestEnv(repo);
      const workspaces = await graph.read();

      expect(graph.ownerOf(workspaces, "vitest.projects.ts")?.name).toBe(
        "alepha-monorepo",
      );
    });
  });

  describe("dependentsOf", () => {
    it("should include the workspace itself", async () => {
      const { graph } = createTestEnv(repo);
      const workspaces = await graph.read();

      expect(graph.dependentsOf(workspaces, ["docs"])).toEqual(
        new Set(["docs"]),
      );
    });

    it("should follow reverse edges transitively", async () => {
      const { graph } = createTestEnv(repo);
      const workspaces = await graph.read();

      // ui is used by lore, and lore by @alepha/lore.
      expect(graph.dependentsOf(workspaces, ["@alepha/ui"])).toEqual(
        new Set(["@alepha/ui", "lore", "@alepha/lore"]),
      );
    });

    /**
     * `lore` and `@alepha/lore` depend on each other. A naive walk over that
     * pair never terminates.
     */
    it("should terminate on a dependency cycle", async () => {
      const { graph } = createTestEnv(repo);
      const workspaces = await graph.read();

      expect(graph.dependentsOf(workspaces, ["lore"])).toEqual(
        new Set(["lore", "@alepha/lore"]),
      );
    });
  });

  describe("affected", () => {
    it("should select only the owner and its dependents", async () => {
      const { graph } = createTestEnv(repo);

      const affected = await graph.affected(["apps/docs/src/index.ts"]);

      expect(affected).toEqual(new Set(["docs"]));
    });

    it("should reach every dependent of the framework", async () => {
      const { graph } = createTestEnv(repo);

      const affected = await graph.affected(["packages/alepha/src/orm/x.ts"]);

      expect(affected).toEqual(
        new Set(["alepha", "@alepha/ui", "@alepha/lore", "lore", "docs"]),
      );
    });

    /**
     * ⚠️ The rule that keeps this honest. A file the root workspace owns is
     * repository-level configuration: `vitest.projects.ts`, `yarn.lock`, a
     * tsconfig, the compose file. Nothing declares a dependency on the root
     * workspace, so following edges would select the root alone and skip every
     * suite the changed file governs. Editing the file that decides which
     * specs run would then run almost none of them.
     */
    it("should select everything when a repo-level file changes", async () => {
      const { graph } = createTestEnv(repo);

      const affected = await graph.affected(["vitest.projects.ts"]);

      expect(affected).toEqual(
        new Set([
          "alepha-monorepo",
          "alepha",
          "@alepha/ui",
          "@alepha/lore",
          "lore",
          "docs",
        ]),
      );
    });

    /**
     * A path under no workspace at all is the same class of unknown, and gets
     * the same conservative answer.
     */
    it("should select everything for a file it cannot place", async () => {
      const { graph } = createTestEnv([
        { name: "alepha", location: "packages/alepha" },
        { name: "docs", location: "apps/docs" },
      ]);

      const affected = await graph.affected(["some/unknown/path.ts"]);

      expect(affected).toEqual(new Set(["alepha", "docs"]));
    });

    it("should select nothing when nothing changed", async () => {
      const { graph } = createTestEnv(repo);

      expect(await graph.affected([])).toEqual(new Set());
    });
  });
});
