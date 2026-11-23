import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  CodeDiffService,
  GitBackend,
  LineDiff,
  LocalGitBackend,
} from "../src/api/index.ts";
import { GitHistory } from "./fixtures/codeRepo.ts";
import {
  GitPlayedArtifactsBackend,
  GitPlayedBinding,
} from "./fixtures/gitPlayedArtifacts.ts";

/**
 * One line diff, in JS, on both backends (#Q4135): the same fixture diffed
 * through `LocalGitBackend` and through `ArtifactsGitBackend` over a
 * git-played binding must answer the same files and the same hunks, and
 * each text file's hunks must rebuild its new side from its old one with
 * git's own counts (`git diff --numstat`).
 */
interface Fixture {
  work: string;
  history: GitHistory;
  root: string;
  tip: string;
  big: string;
  /**
   * The services, by backend.
   */
  services: Record<
    "local" | "artifacts",
    { diff: CodeDiffService; ref: string }
  >;
}

const lines = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join("\n");

describe("code diff", () => {
  let f: Fixture;

  beforeAll(async () => {
    const work = mkdtempSync(join(tmpdir(), "lore-diff-"));
    const bare = join(work, "repo.git");
    execFileSync("git", ["init", "--bare", "--quiet", bare]);
    execFileSync("git", [
      "--git-dir",
      bare,
      "symbolic-ref",
      "HEAD",
      "refs/heads/main",
    ]);
    const history = new GitHistory(join(work, "source"), bare);
    const root = history.commit("root", {
      "a.txt": `${lines(40, "a")}\n`,
      "gone.txt": "bye\n",
      "move/me.txt": "moved content\n",
      "tail.txt": "no newline\n",
      "yarn.lock": "lock 1\n",
      "run.sh": "echo hi\n",
      "bin.dat": "\u0000\u0001\u0002",
    });
    const tip = history.commit("change", {
      // Edits at the top, the middle and the end, far enough apart for
      // three hunks.
      "a.txt": `${lines(40, "a")
        .split("\n")
        .map((line, i) =>
          i === 1 ? "changed top" : i === 20 ? "changed middle" : line,
        )
        .join("\n")}\nadded end\n`,
      "gone.txt": null,
      "move/me.txt": null,
      "moved/me.txt": "moved content\n",
      "tail.txt": "no newline",
      "new.txt": "fresh\n",
      "yarn.lock": "lock 2\n",
      "bin.dat": "\u0000\u0003",
    });
    chmodSync(join(history.work, "run.sh"), 0o755);
    const big = history.commit("mode and big", {
      "big.txt": `${"x".repeat(300 * 1024)}\n`,
    });
    history.push();

    const local = Alepha.create({
      env: { LOG_LEVEL: "error", DATA_DIR: join(work, "data") },
    }).with({ provide: GitBackend, use: LocalGitBackend });
    const backend = local.inject(LocalGitBackend);
    const ref = backend.refFor({ projectId: 1, repoId: crypto.randomUUID() });
    await backend.create(ref, { defaultBranch: "main" });
    history.git("push", "--quiet", backend.pathOf(ref), "--all");

    const played = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: GitBackend,
      use: GitPlayedArtifactsBackend,
    });
    played.set(
      "cloudflare.env" as never,
      { ARTIFACTS: new GitPlayedBinding(bare) } as never,
    );
    f = {
      work,
      history,
      root,
      tip,
      big,
      services: {
        local: { diff: local.inject(CodeDiffService), ref },
        artifacts: { diff: played.inject(CodeDiffService), ref: "1-a" },
      },
    };
  });

  afterAll(() => {
    rmSync(f.work, { recursive: true, force: true });
  });

  const numstat = (from: string, to: string) =>
    Object.fromEntries(
      f.history
        .git("diff", "--numstat", "--no-renames", from, to)
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [add, del, path] = line.split("\t");
          return [path, [add, del]];
        }),
    );

  for (const backend of ["local", "artifacts"] as const) {
    it(`answers the files and the hunks git counts, on ${backend}`, async ({
      expect,
    }) => {
      const { diff, ref } = f.services[backend];
      const result = await diff.diff(ref, f.root, f.tip);
      expect(result).toMatchObject({ total: 7, partial: false, page: 0 });
      const by = Object.fromEntries(result.files.map((it) => [it.path, it]));
      expect(result.files.map((it) => [it.path, it.kind, it.status])).toEqual([
        ["a.txt", "modified", "loaded"],
        ["bin.dat", "modified", "binary"],
        ["gone.txt", "deleted", "loaded"],
        ["moved/me.txt", "renamed", "loaded"],
        ["new.txt", "added", "loaded"],
        ["tail.txt", "modified", "loaded"],
        ["yarn.lock", "modified", "collapsed"],
      ]);
      expect(by["moved/me.txt"]).toMatchObject({
        oldPath: "move/me.txt",
        additions: 0,
        deletions: 0,
      });

      const git = numstat(f.root, f.tip);
      for (const path of ["a.txt", "gone.txt", "new.txt", "tail.txt"]) {
        const file = by[path]!;
        expect([String(file.additions), String(file.deletions)], path).toEqual(
          git[path],
        );
      }
      // Three hunks for three changes far apart, with git's headers.
      expect(
        by["a.txt"]!.hunks!.map(
          (h) =>
            `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
        ),
      ).toEqual(
        f.history
          .git("diff", "-U3", f.root, f.tip, "--", "a.txt")
          .split("\n")
          .filter((line) => line.startsWith("@@"))
          .map((line) => line.replace(/ @@.*$/, " @@")),
      );
      const tail = by["tail.txt"]!.hunks![0]!.lines;
      expect(
        tail.map((it) => [it.kind, it.text, it.noNewline ?? false]),
      ).toEqual([
        ["del", "no newline", false],
        ["add", "no newline", true],
      ]);
      expect(tail.map((it) => it.anchor)).toEqual([
        "tail.txt:old:1",
        "tail.txt:new:1",
      ]);

      // A collapsed lockfile loads on demand.
      const lock = await diff.file(ref, f.root, f.tip, "yarn.lock");
      expect(lock).toMatchObject({
        status: "loaded",
        additions: 1,
        deletions: 1,
      });

      // A root commit diffs from the empty tree; a mode change and a file
      // over the cap say so.
      const first = await diff.diff(ref, undefined, f.root);
      expect(first.files.every((it) => it.kind === "added")).toBe(true);
      const later = await diff.diff(ref, f.tip, f.big);
      expect(
        later.files.map((it) => [it.path, it.status, it.oldMode, it.newMode]),
      ).toEqual([
        ["big.txt", "too_large", undefined, "100644"],
        ["run.sh", "loaded", "100644", "100755"],
      ]);

      // Context between hunks, from the blob.
      expect(await diff.lines(ref, by["a.txt"]!.newSha!, 5, 7)).toEqual([
        "a line 5",
        "a line 6",
        "a line 7",
      ]);
    });
  }

  it("answers the same diff on both backends", async ({ expect }) => {
    const [local, artifacts] = await Promise.all(
      (["local", "artifacts"] as const).map((key) =>
        f.services[key].diff.diff(f.services[key].ref, f.root, f.tip),
      ),
    );
    expect(artifacts).toEqual(local);
  });

  it("rebuilds the new side from the old one, and stops at its edit ceiling", ({
    expect,
  }) => {
    const a = ["x", "a", "b", "c", "a", "b", "b", "a"];
    const b = ["c", "b", "a", "b", "a", "c", "x"];
    const ops = LineDiff.diff(a, b)!;
    const rebuilt = ops.flatMap((op) =>
      op.kind === "delete" ? [] : [b[op.b]!],
    );
    expect(rebuilt).toEqual(b);
    expect(ops.filter((op) => op.kind !== "equal")).toHaveLength(7);
    // Every line different: 20 edits, refused under a ceiling of 10.
    const left = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const right = Array.from({ length: 10 }, (_, i) => `r${i}`);
    expect(LineDiff.diff(left, right, 10)).toBeUndefined();
    expect(LineDiff.diff(left, right, 20)).toHaveLength(20);
  });
});
