import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { AlephaCommands } from "./commands.ts";

/**
 * The selection helpers are protected, so a subclass exposes them rather than
 * the pipeline being driven end to end for a string comparison.
 */
class TestAlephaCommands extends AlephaCommands {
  public testTestCommand = this.testCommand.bind(this);
  public testForeachCommand = this.foreachCommand.bind(this);
  public testRunsCliSuite = this.runsCliSuite.bind(this);
  public testSelectAffected = this.selectAffected.bind(this);
  public testSelectOrRunEverything = this.selectOrRunEverything.bind(this);
}

const selection = (
  names: string[],
  projects: string[],
  everything = false,
) => ({ names, projects, everything });

describe("AlephaCommands --affected", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

    return {
      shell: alepha.inject(MemoryShellProvider),
      fs: alepha.inject(MemoryFileSystemProvider),
      cmd: alepha.inject(TestAlephaCommands),
    };
  };

  describe("testCommand", () => {
    it("should run the whole suite when the flag is absent", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testTestCommand(undefined)).toBe("yarn test");
    });

    it("should run the whole suite when everything is affected", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testTestCommand(selection(["lore"], ["lore*"], true))).toBe(
        "yarn test",
      );
    });

    it("should filter to the affected projects", () => {
      const { cmd } = createTestEnv();

      expect(
        cmd.testTestCommand(selection(["docs", "lore"], ["docs*", "lore*"])),
      ).toBe("yarn alepha test --project docs*,lore*");
    });

    /**
     * ⚠️ The dangerous case. An empty project list handed to vitest is not a
     * filter that matches nothing, it is no filter at all, so the step would
     * quietly run the entire suite while the log claimed a narrow selection.
     * `null` is the signal to skip it and say so.
     */
    it("should skip rather than pass an empty filter", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testTestCommand(selection(["bay"], []))).toBeNull();
    });
  });

  describe("foreachCommand", () => {
    it("should fan out to every workspace when nothing is selected", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testForeachCommand("e2e", undefined)).toBe("yarn e2e");
    });

    it("should pass one --include per affected workspace", () => {
      const { cmd } = createTestEnv();

      expect(
        cmd.testForeachCommand("build", selection(["lore", "@alepha/ui"], [])),
      ).toBe(
        "yarn workspaces foreach -Apt --include lore --include @alepha/ui run build",
      );
    });

    it("should skip when nothing is affected", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testForeachCommand("build", selection([], []))).toBeNull();
    });
  });

  /**
   * `e2e-cli` consumes a packed tarball rather than importing anything, so it
   * has no edge in the workspace graph and would never be selected by it.
   */
  describe("runsCliSuite", () => {
    it("should run when the framework is affected", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testRunsCliSuite(selection(["alepha"], ["alepha*"]))).toBe(
        true,
      );
    });

    it("should run when the scaffolder is affected", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testRunsCliSuite(selection(["create-alepha"], []))).toBe(true);
    });

    it("should not run for an app-only change", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testRunsCliSuite(selection(["lore"], ["lore*"]))).toBe(false);
    });

    it("should run when the flag is absent", () => {
      const { cmd } = createTestEnv();

      expect(cmd.testRunsCliSuite(undefined)).toBe(true);
    });
  });

  describe("selectAffected", () => {
    const graph = [
      { name: "alepha-monorepo", location: ".", workspaceDependencies: [] },
      {
        name: "alepha",
        location: "packages/alepha",
        workspaceDependencies: [],
      },
      {
        name: "lore",
        location: "apps/lore",
        workspaceDependencies: ["packages/alepha"],
      },
      {
        name: "bay",
        location: "apps/bay",
        workspaceDependencies: [],
      },
    ];

    const arrange = async (changed: string[]) => {
      const env = createTestEnv();
      env.shell.outputs.set(
        "yarn workspaces list -v --json",
        graph.map((row) => JSON.stringify(row)).join("\n"),
      );
      env.shell.outputs.set(
        "git diff --name-only origin/main...HEAD",
        changed.join("\n"),
      );
      env.shell.outputs.set("git diff --name-only HEAD", "");
      env.shell.outputs.set("git ls-files --others --exclude-standard", "");
      // Only these two own a vitest config in this fixture.
      await env.fs.writeFile("apps/lore/vitest.config.ts", "");
      await env.fs.writeFile("packages/alepha/vitest.config.ts", "");
      return env;
    };

    it("should select an app and give it a globbed project filter", async () => {
      const { cmd } = await arrange(["apps/lore/src/web/App.tsx"]);

      const affected = await cmd.testSelectAffected("origin/main");

      expect(affected.names).toEqual(["lore"]);
      expect(affected.projects).toEqual(["lore*"]);
      expect(affected.everything).toBe(false);
    });

    /**
     * `apps/bay` is Go. It is a workspace, so it can be selected, but it owns
     * no vitest config and must not contribute a project filter naming a
     * project that does not exist: vitest fails the whole run on an unmatched
     * filter.
     */
    it("should not invent a project for a workspace with no config", async () => {
      const { cmd } = await arrange(["apps/bay/main.go"]);

      const affected = await cmd.testSelectAffected("origin/main");

      expect(affected.names).toEqual(["bay"]);
      expect(affected.projects).toEqual([]);
    });

    it("should report everything for a repo-level change", async () => {
      const { cmd } = await arrange(["vitest.projects.ts"]);

      const affected = await cmd.testSelectAffected("origin/main");

      expect(affected.everything).toBe(true);
    });
  });

  /**
   * The selection is on by default, so it must not be able to break a run that
   * would otherwise have worked: a checkout with no `origin/main`, a remote
   * under another name, a git that will not answer.
   *
   * ⚠️ It degrades UPWARDS. `undefined` here is what the command receives when
   * the flag was never passed, so every step runs. The failure to avoid is the
   * opposite one, an empty selection, which would skip every suite and report
   * success; `ChangedFiles` raises rather than reporting that, and this turns
   * the raise into the full pipeline.
   */
  describe("selectOrRunEverything", () => {
    it("should verify everything when the ref cannot be resolved", async () => {
      const env = createTestEnv();
      env.shell.errors.set(
        "git diff --name-only origin/nope...HEAD",
        "fatal: bad revision",
      );

      expect(
        await env.cmd.testSelectOrRunEverything("origin/nope"),
      ).toBeUndefined();
    });

    it("should still select normally when git answers", async () => {
      const env = createTestEnv();
      env.shell.outputs.set(
        "yarn workspaces list -v --json",
        JSON.stringify({ name: "alepha", location: "packages/alepha" }),
      );
      env.shell.outputs.set(
        "git diff --name-only origin/main...HEAD",
        "packages/alepha/src/x.ts",
      );
      env.shell.outputs.set("git diff --name-only HEAD", "");
      env.shell.outputs.set("git ls-files --others --exclude-standard", "");

      const affected = await env.cmd.testSelectOrRunEverything("origin/main");

      expect(affected?.names).toEqual(["alepha"]);
    });
  });
});
