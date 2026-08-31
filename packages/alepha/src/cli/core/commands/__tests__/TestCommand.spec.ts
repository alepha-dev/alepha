import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { TestCommand } from "../test.ts";

/**
 * The argv this command builds is a concatenated shell string, so every
 * assertion here is about what ends up on the command line rather than about
 * a precedence the API guarantees.
 *
 * Three of the shapes below were established by running vitest 4.1.10 rather
 * than read off its documentation, and each one is a case where the obvious
 * spelling is wrong:
 *
 * - `--coverage.reporter=json-summary` REPLACES the config's `reporter:
 *   ["html"]`, so the local HTML report disappears unless it is named again.
 * - `--reporter=json` alone REPLACES the default reporter, so CI keeps the
 *   file and loses every readable line of test output.
 * - repeated `--coverage.reporter` flags ACCUMULATE, which is what makes
 *   naming both of them work at all.
 */
describe("TestCommand", () => {
  const argv = async (flags: string) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const cli = alepha.inject(CliProvider);
    const test = alepha.inject(TestCommand);
    const shell = alepha.inject(MemoryShellProvider);

    await cli.run(test.test, { argv: flags, root: "/app" });
    return shell.calls.map((it) => it.command).join("\n");
  };

  it("runs vitest with no report flags by default", async () => {
    const command = await argv("");

    expect(command).toContain("vitest");
    expect(command).toContain(" run");
    expect(command).not.toContain("--coverage");
    expect(command).not.toContain("--reporter");
  });

  describe("--coverage", () => {
    it("turns on coverage with the json-summary reporter", async () => {
      const command = await argv("--coverage");

      expect(command).toContain("--coverage ");
      expect(command).toContain("--coverage.reporter=json-summary");
    });

    /**
     * The flag replaces the config's reporter list rather than adding to it,
     * so asking for the machine-readable report silently costs the developer
     * the browsable one. Both are named.
     */
    it("keeps the browsable html report alongside json-summary", async () => {
      expect(await argv("--coverage")).toContain("--coverage.reporter=html");
    });

    it("writes the vitest json test report beside the coverage summary", async () => {
      const command = await argv("--coverage");

      expect(command).toContain("--reporter=json");
      expect(command).toContain("--outputFile.json=coverage/test-results.json");
    });

    /**
     * `--outputFile=` is the ambiguous spelling once more than one reporter is
     * configured: it names a path with nothing saying which reporter owns it.
     */
    it("uses the keyed --outputFile.json= form", async () => {
      expect(await argv("--coverage")).not.toMatch(/--outputFile=/);
    });

    it("keeps the default reporter so CI still prints test output", async () => {
      expect(await argv("--coverage")).toContain("--reporter=default");
    });
  });

  /**
   * VITEST_ARGS is the escape hatch, and with a concatenated string the only
   * thing that makes it one is position: whatever the caller sets has to come
   * last on the line.
   *
   * ⚠️ Set on `process.env` rather than through `Alepha.create({ env })`,
   * because `CliProvider.parseCommandEnv` reads `process.env` directly. A
   * container-level override is invisible to a `$command`'s `env` schema.
   */
  it("puts VITEST_ARGS last, after the flags it builds itself", async () => {
    const previous = process.env.VITEST_ARGS;
    process.env.VITEST_ARGS = "--coverage.reporter=lcov";

    try {
      const command = await argv("--coverage");

      expect(command.trim().endsWith("--coverage.reporter=lcov")).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.VITEST_ARGS;
      } else {
        process.env.VITEST_ARGS = previous;
      }
    }
  });
});
