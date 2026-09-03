import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { ChangedFiles } from "../services/ChangedFiles.ts";

describe("ChangedFiles", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with({
      provide: ShellProvider,
      use: MemoryShellProvider,
    });

    return {
      shell: alepha.inject(MemoryShellProvider),
      changed: alepha.inject(ChangedFiles),
    };
  };

  it("should union committed, uncommitted and untracked files", async () => {
    const { shell, changed } = createTestEnv();
    shell.outputs.set(
      "git diff --name-only origin/main...HEAD",
      "packages/alepha/src/orm/a.ts\n",
    );
    shell.outputs.set("git diff --name-only HEAD", "apps/lore/src/b.ts\n");
    shell.outputs.set(
      "git ls-files --others --exclude-standard",
      "apps/docs/src/c.ts\n",
    );

    expect(await changed.since("origin/main")).toEqual([
      "apps/docs/src/c.ts",
      "apps/lore/src/b.ts",
      "packages/alepha/src/orm/a.ts",
    ]);
  });

  it("should list a file touched in two places only once", async () => {
    const { shell, changed } = createTestEnv();
    shell.outputs.set(
      "git diff --name-only origin/main...HEAD",
      "apps/lore/src/b.ts\n",
    );
    shell.outputs.set("git diff --name-only HEAD", "apps/lore/src/b.ts\n");
    shell.outputs.set("git ls-files --others --exclude-standard", "");

    expect(await changed.since("origin/main")).toEqual(["apps/lore/src/b.ts"]);
  });

  /**
   * ⚠️ The failure that matters. An empty list means "nothing changed", which
   * an affected-only pipeline turns into "run nothing" and then reports
   * success. A git that cannot answer, an unknown ref, a detached checkout
   * with no remote, must therefore raise rather than resolve empty: the one
   * answer this class must never invent is silence.
   */
  it("should raise rather than report nothing when git fails", async () => {
    const { shell, changed } = createTestEnv();
    shell.errors.set(
      "git diff --name-only origin/nope...HEAD",
      "fatal: bad revision",
    );

    await expect(changed.since("origin/nope")).rejects.toThrowError(
      /origin\/nope/,
    );
  });

  it("should compare against the requested ref", async () => {
    const { shell, changed } = createTestEnv();
    shell.outputs.set("git diff --name-only v1.2.3...HEAD", "");
    shell.outputs.set("git diff --name-only HEAD", "");
    shell.outputs.set("git ls-files --others --exclude-standard", "");

    await changed.since("v1.2.3");

    expect(shell.wasCalled("git diff --name-only v1.2.3...HEAD")).toBe(true);
  });
});
