import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { NodeShellProvider, ShellProvider } from "alepha/system";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCodeImport } from "../services/LoreCodeImport.ts";

/**
 * `lore code import`'s slicer (#Q3935) with the real `git`, against a bare
 * repository over `file://` whose hooks stand in for Artifacts: a
 * `pre-receive` that records every push (its refs, its new-object count,
 * its push options) and, when asked, refuses one over a budget with
 * Artifacts' own words.
 */
describe("lore code import", () => {
  let work: string;
  let source: string;
  let remote: string;
  let log: string;

  const env = {
    PATH: process.env.PATH ?? "",
    HOME: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "ana",
    GIT_AUTHOR_EMAIL: "ana@example.com",
    GIT_COMMITTER_NAME: "ana",
    GIT_COMMITTER_EMAIL: "ana@example.com",
  };

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env: { ...env, HOME: work },
      encoding: "utf8",
    }).trim();

  const commit = (name: string, files = 1) => {
    for (let i = 0; i < files; i++) {
      writeFileSync(join(source, `${name}-${i}.txt`), `${name} ${i}\n`);
    }
    git(source, "add", "-A");
    git(source, "commit", "--quiet", "-m", name);
  };

  /**
   * The remote's hook. `REFUSE_OVER` makes it refuse a push carrying more
   * new objects, as Artifacts refuses one over its unpack budget;
   * `FAIL_AFTER` makes it fail every push past that many, as an
   * interruption would.
   */
  const hook = (options: { refuseOver?: number; failAfter?: number } = {}) => {
    const path = join(remote, "hooks", "pre-receive");
    writeFileSync(
      path,
      `#!/bin/sh
count=$(cat "${log}.count" 2>/dev/null || echo 0)
${options.failAfter ? `if [ "$count" -ge ${options.failAfter} ]; then echo "connection reset" >&2; exit 1; fi` : ""}
while read old new ref; do
  if [ "$new" = "0000000000000000000000000000000000000000" ]; then
    echo "delete $ref" >> "${log}"; continue
  fi
  objects=$(git rev-list --count --objects "$new" --not --all)
  ${options.refuseOver ? `if [ "$objects" -gt ${options.refuseOver} ]; then echo "error: pack offset metadata exceeds memory budget" >&2; exit 1; fi` : ""}
  echo "push $ref $objects \${GIT_PUSH_OPTION_0:-none}" >> "${log}"
done
echo $((count + 1)) > "${log}.count"
`,
    );
    chmodSync(path, 0o755);
  };

  const pushes = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
      : [];

  const importer = () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", HOME: work },
    }).with({
      provide: ShellProvider,
      use: NodeShellProvider,
    });
    return alepha.inject(LoreCodeImport);
  };

  const run = (options: Partial<Parameters<LoreCodeImport["run"]>[0]> = {}) =>
    importer().run({
      root: source,
      url: `file://${remote}`,
      source: "main",
      branch: "main",
      sliced: true,
      maxObjects: 12,
      ...options,
    });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "lore-import-"));
    source = join(work, "source");
    remote = join(work, "remote.git");
    log = join(work, "pushes.log");
    git(work, "init", "--quiet", "-b", "main", source);
    git(work, "init", "--quiet", "--bare", remote);
    git(remote, "config", "receive.advertisePushOptions", "true");
    git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    for (let i = 0; i < 12; i++) commit(`main-${i}`);
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("moves the default branch forward in slices under the budget, every push marked", async ({
    expect,
  }) => {
    hook();
    const head = git(source, "rev-parse", "HEAD");

    const result = await run();

    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(head);
    const lines = pushes();
    expect(lines.length).toBeGreaterThan(1);
    expect(result.pushes).toBe(lines.length);
    for (const line of lines) {
      const [, ref, objects, option] = line.split(" ");
      expect(ref).toBe("refs/heads/main");
      expect(Number(objects)).toBeLessThanOrEqual(12);
      expect(option).toBe("lore-import");
    }
  });

  it("pushes a merge over the budget alone through a temporary ref, then deletes it", async ({
    expect,
  }) => {
    git(source, "checkout", "--quiet", "-b", "feature");
    for (let i = 0; i < 8; i++) commit(`feature-${i}`, 2);
    git(source, "checkout", "--quiet", "main");
    git(source, "merge", "--quiet", "--no-ff", "-m", "merge", "feature");
    git(source, "branch", "--quiet", "-D", "feature");
    hook();

    await run();

    const lines = pushes();
    expect(
      lines.some((line) => line.startsWith("push refs/lore-import/1 ")),
    ).toBe(true);
    expect(lines.at(-1)).toBe("delete refs/lore-import/1");
    expect(git(remote, "for-each-ref", "refs/lore-import")).toBe("");
    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
  });

  it("halves its budget when a push is refused as too big", async ({
    expect,
  }) => {
    hook({ refuseOver: 6 });

    await run();

    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
    for (const line of pushes()) {
      expect(Number(line.split(" ")[2])).toBeLessThanOrEqual(6);
    }
  });

  it("resumes from the remote's refs after an interruption", async ({
    expect,
  }) => {
    hook({ failAfter: 1 });
    await expect(run()).rejects.toThrow(/git push failed/);
    const halfway = git(remote, "rev-parse", "refs/heads/main");
    hook();

    await run();

    expect(halfway).not.toBe(git(source, "rev-parse", "HEAD"));
    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
    // Nothing went twice: the pushes together carry the history once.
    const carried = pushes().reduce(
      (sum, line) => sum + Number(line.split(" ")[2]),
      0,
    );
    expect(carried).toBe(
      Number(git(source, "rev-list", "--count", "--objects", "HEAD")),
    );
  });

  it("pushes the other branches and the tags after the default branch", async ({
    expect,
  }) => {
    git(source, "tag", "v1.0.0", "HEAD~3");
    git(source, "tag", "-a", "-m", "two", "v2.0.0");
    git(source, "checkout", "--quiet", "-b", "docs");
    commit("docs", 3);
    git(source, "checkout", "--quiet", "main");
    hook();

    await run();

    expect(git(remote, "rev-parse", "refs/heads/docs")).toBe(
      git(source, "rev-parse", "docs"),
    );
    expect(git(remote, "tag", "--list").split("\n").sort()).toEqual([
      "v1.0.0",
      "v2.0.0",
    ]);
    expect(pushes()[0]).toMatch(/^push refs\/heads\/main /);
  });

  it("stops before any push on a file over the per-file cap, naming it", async ({
    expect,
  }) => {
    writeFileSync(join(source, "big.bin"), "x".repeat(4096));
    git(source, "add", "big.bin");
    git(source, "commit", "--quiet", "-m", "big");
    hook();

    await expect(run({ maxFileBytes: 1024 })).rejects.toThrow(/big\.bin/);
    expect(pushes()).toEqual([]);
  });

  it("pushes in one go on a backend with no cap", async ({ expect }) => {
    hook();

    await run({ sliced: false });

    expect(pushes()).toHaveLength(1);
    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
  });
});
