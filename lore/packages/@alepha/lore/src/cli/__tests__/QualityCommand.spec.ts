import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { loreOptions } from "../atoms/loreOptions.ts";
import { QualityCommand } from "../commands/QualityCommand.ts";

/**
 * The command that closes the loop: read what `alepha test --coverage` wrote,
 * extract the totals, and post them with the raw reports behind them.
 *
 * Two of the fields it sends are NOT in the payload it reads, and both were
 * verified against a real vitest 4.1.10 run rather than assumed:
 *
 * - the report has **no top-level duration**, so it is derived;
 * - "skipped" has **two sources**, `numPendingTests` and `numTodoTests`, and
 *   there is one column.
 */
class FakeLinkProvider extends LinkProvider {
  public pushes: any[] = [];
  public rejectWith?: Error;

  /**
   * The two endpoints the command reaches: the slug lookup that turns
   * `--project alepha` into the integer id every project-scoped endpoint
   * takes, and the push itself.
   */
  public slugLookups: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      getProjectBySlug: async (config: any) => {
        this.slugLookups.push(config.params.slug);
        return { id: 7, slug: config.params.slug };
      },
      pushQualityRun: async (config: any) => {
        if (this.rejectWith) throw this.rejectWith;
        this.pushes.push(config);
        return { id: "00000000-0000-4000-8000-000000000001" };
      },
    };
  }
}

/**
 * What vitest actually writes, trimmed to the fields the command reads.
 */
const coverageSummary = {
  total: {
    lines: { total: 100, covered: 71, skipped: 0, pct: 71.2 },
    statements: { total: 100, covered: 70, skipped: 0, pct: 70.9 },
    functions: { total: 100, covered: 64, skipped: 0, pct: 64.4 },
    branches: { total: 100, covered: 82, skipped: 0, pct: 82.1 },
  },
};

const testResults = {
  numTotalTests: 8526,
  numPassedTests: 8520,
  numFailedTests: 1,
  numPendingTests: 3,
  numTodoTests: 2,
  startTime: 1_788_195_327_291,
  testResults: [
    { startTime: 1_788_195_327_520, endTime: 1_788_195_328_268 },
    { startTime: 1_788_195_327_600, endTime: 1_788_195_459_291 },
  ],
};

describe("alepha lore quality push", () => {
  const setup = async (
    options: {
      files?: Record<string, string>;
      env?: Record<string, string>;
      git?: Record<string, string>;
    } = {},
  ) => {
    const alepha = Alepha.create({
      env: { LORE_API_KEY: "lore_secret", ...options.env },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: FakeLinkProvider });

    alepha.set(loreOptions, { project: "alepha" });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const files = options.files ?? {
      "/repo/coverage/coverage-summary.json": JSON.stringify(coverageSummary),
      "/repo/coverage/test-results.json": JSON.stringify(testResults),
    };
    for (const [path, content] of Object.entries(files)) {
      await fs.writeFile(path, content);
    }

    const shell = alepha.inject(MemoryShellProvider);
    for (const [command, output] of Object.entries(options.git ?? {})) {
      shell.outputs.set(command, output);
    }

    return {
      cli: alepha.inject(CliProvider),
      command: alepha.inject(QualityCommand),
      link: alepha.inject(FakeLinkProvider),
      shell,
    };
  };

  const push = async (options: Parameters<typeof setup>[0] = {}, argv = "") => {
    const ctx = await setup(options);
    await ctx.cli.run(ctx.command.push, { argv, root: "/repo" });
    return ctx;
  };

  describe("what it sends", () => {
    it("posts the coverage totals under the named project", async () => {
      const ctx = await push({
        env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" },
      });

      expect(ctx.link.pushes).toHaveLength(1);
      const body = ctx.link.pushes[0].body;
      expect(body.coverage).toEqual({
        lines: 71.2,
        statements: 70.9,
        functions: 64.4,
        branches: 82.1,
      });
      expect(body.tests.total).toBe(8526);
      expect(body.tests.passed).toBe(8520);
      expect(body.tests.failed).toBe(1);
    });

    /**
     * ⚠️ Two sources, one column. Reading it back as `numPendingTests` alone
     * would under-report by every `.todo` in the suite.
     */
    it("sums pending and todo into one skipped count", async () => {
      const ctx = await push({
        env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" },
      });

      expect(ctx.link.pushes[0].body.tests.skipped).toBe(5);
    });

    /**
     * ⚠️ There is no top-level duration field in the vitest JSON report.
     * `'duration' in report` is false. It is the furthest per-file `endTime`
     * minus the run's own `startTime`, which is what makes a parallel run
     * report its wall clock rather than the sum of its files.
     */
    it("derives the duration from the furthest file end", async () => {
      const ctx = await push({
        env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" },
      });

      expect(ctx.link.pushes[0].body.durationMs).toBe(132_000);
    });

    it("carries the raw reports so a later parse needs no CI re-run", async () => {
      const ctx = await push({
        env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" },
      });

      const reports = ctx.link.pushes[0].body.reports;
      expect(reports.coverage.total.lines.pct).toBe(71.2);
      expect(reports.tests.numTotalTests).toBe(8526);
    });
  });

  describe("which commit", () => {
    it("prefers what CI already knows", async () => {
      const ctx = await push({
        env: { GITHUB_SHA: "cafebabe1234", GITHUB_REF_NAME: "release/1.0" },
        git: { "git rev-parse HEAD": "should-not-be-read\n" },
      });

      expect(ctx.link.pushes[0].body.commitSha).toBe("cafebabe1234");
      expect(ctx.link.pushes[0].body.branch).toBe("release/1.0");
      expect(ctx.shell.calls).toHaveLength(0);
    });

    /**
     * ⚠️ Not `git rev-parse --abbrev-ref HEAD`: a CI checkout is detached by
     * default, where that answers the literal string `HEAD`.
     */
    it("falls back to git, through ShellProvider", async () => {
      const ctx = await push({
        git: {
          "git rev-parse HEAD": "abc1234def5678\n",
          "git rev-parse --abbrev-ref HEAD": "feature/quality\n",
        },
      });

      expect(ctx.link.pushes[0].body.commitSha).toBe("abc1234def5678");
      expect(ctx.link.pushes[0].body.branch).toBe("feature/quality");
    });

    it("does not send a detached HEAD as a branch name", async () => {
      const ctx = await push({
        git: {
          "git rev-parse HEAD": "abc1234def5678\n",
          "git rev-parse --abbrev-ref HEAD": "HEAD\n",
        },
      });

      expect(ctx.link.pushes[0].body.branch).not.toBe("HEAD");
    });
  });

  describe("--project", () => {
    it("overrides the configured project for one invocation", async () => {
      const ctx = await push(
        { env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" } },
        "--project other",
      );

      expect(ctx.link.slugLookups).toEqual(["other"]);
    });

    /**
     * `--project` names a project the way a person does, by the slug in its
     * URL. Every project-scoped endpoint takes an integer id, so the command
     * translates rather than making Lore grow a second gate shape.
     */
    it("resolves the slug to the integer id the endpoint takes", async () => {
      const ctx = await push({
        env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" },
      });

      expect(ctx.link.slugLookups).toEqual(["alepha"]);
      expect(ctx.link.pushes[0].params.projectId).toBe(7);
    });

    /**
     * A caller that already holds an id pays no round trip for it.
     */
    it("takes a numeric project as an id, with no lookup", async () => {
      const ctx = await push(
        { env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" } },
        "--project 42",
      );

      expect(ctx.link.slugLookups).toEqual([]);
      expect(ctx.link.pushes[0].params.projectId).toBe(42);
    });
  });

  describe("when it cannot", () => {
    /**
     * The single most-hit surface of this whole epic: someone runs the push
     * without the run that produces its input.
     */
    it("names the command that writes the reports", async () => {
      const ctx = await setup({ files: {} });

      await expect(
        ctx.cli.run(ctx.command.push, { argv: "", root: "/repo" }),
      ).rejects.toThrowError(/alepha test --coverage/);
    });

    it("names the file it could not find", async () => {
      const ctx = await setup({
        files: {
          "/repo/coverage/coverage-summary.json":
            JSON.stringify(coverageSummary),
        },
      });

      await expect(
        ctx.cli.run(ctx.command.push, { argv: "", root: "/repo" }),
      ).rejects.toThrowError(/test-results\.json/);
    });

    /**
     * Fail loudly, with no opt-out flag in v1. The safety comes from where the
     * command runs - a main-only coverage job that gates nothing - rather than
     * from a flag that would let a broken push go unnoticed.
     */
    it("lets a failed push fail the build", async () => {
      const ctx = await setup({
        env: { GITHUB_SHA: "0b35cb3", GITHUB_REF_NAME: "main" },
      });
      ctx.link.rejectWith = new Error("401 Unauthorized");

      await expect(
        ctx.cli.run(ctx.command.push, { argv: "", root: "/repo" }),
      ).rejects.toThrow();
    });
  });
});
