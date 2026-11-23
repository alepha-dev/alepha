import { afterEach, describe, it } from "vitest";

import {
  CodeBlameService,
  CodeBrowserController,
  CodeCommitIndex,
} from "../src/api/index.ts";
import { bootCodeRepo, type CodeRepoContext } from "./fixtures/codeRepo.ts";

/**
 * Blame from the commit index (#Q4138), checked line by line against `git
 * blame` on the same history: edits on two branches merged back, an exact
 * rename, an edit after it. Then the cap: a long history continues as a
 * `pending` walk the job finishes.
 */
describe("code blame", () => {
  let ctx: CodeRepoContext;

  afterEach(async () => {
    await ctx?.stop();
  });

  const lines = (edits: Record<number, string> = {}) =>
    `${Array.from({ length: 10 }, (_, i) => edits[i + 1] ?? `line ${i + 1}`).join("\n")}\n`;

  const gitBlame = (rev: string, path: string) => {
    const out = ctx.history.git("blame", "--porcelain", rev, "--", path);
    return out
      .split("\n")
      .filter((line) => /^[0-9a-f]{40} \d+ \d+/.test(line))
      .map((line) => line.split(" ")[0]!);
  };

  const ours = (
    ranges: Array<{ startLine: number; endLine: number; commitSha?: string }>,
  ) =>
    ranges.flatMap((range) =>
      Array.from(
        { length: range.endLine - range.startLine + 1 },
        () => range.commitSha,
      ),
    );

  it("answers each line's commit as git blame does, through a merge and a rename", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const h = ctx.history;
    h.commit("c1", { "f.txt": lines() });
    h.commit("c2", { "f.txt": lines({ 3: "three" }) });
    h.checkout("-b", "side");
    h.commit("s1", { "f.txt": lines({ 3: "three", 8: "eight" }) });
    h.checkout("main");
    h.commit("c3", { "f.txt": lines({ 1: "one", 3: "three" }) });
    h.merge("side", "merge side");
    h.git("mv", "f.txt", "g.txt");
    h.commit("rename");
    const tip = h.commit("c5", {
      "g.txt": lines({ 1: "one", 3: "three", 5: "five", 8: "eight" }),
    });
    h.push();
    await ctx.alepha.inject(CodeCommitIndex).walk(ctx.repository, [tip], 100);

    const blame = (
      await ctx.alepha.inject(CodeBrowserController).getCodeBlame.fetch(
        {
          params: { projectId: ctx.projectId, slug: ctx.repository.slug },
          query: { ref: "main", path: "g.txt" },
        },
        { user: ctx.owner as never },
      )
    ).data;
    expect(blame.status).toBe("ready");
    expect(ours(blame.ranges)).toEqual(gitBlame(tip, "g.txt"));
    // A line older than the rename keeps the name it had then.
    expect(blame.ranges.find((it) => it.startLine === 2)?.originalPath).toBe(
      "f.txt",
    );
    expect(blame.text).toBe(
      lines({ 1: "one", 3: "three", 5: "five", 8: "eight" }),
    );
    expect(new Set(blame.commits.map((it) => it.subject))).toEqual(
      new Set(["c1", "c2", "s1", "c3", "c5"]),
    );

    // Kept: asked again, it is read, not walked.
    const again = await ctx.alepha
      .inject(CodeBlameService)
      .find(ctx.repository.id, tip, "g.txt");
    expect(again?.status).toBe("ready");
  });

  it("continues a long walk as pending, which the job finishes", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const h = ctx.history;
    let tip = "";
    const rows = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    tip = h.commit("start", { "f.txt": `${rows.join("\n")}\n` });
    for (let i = 0; i < 30; i++) {
      rows[i] = `edited ${i}`;
      tip = h.commit(`edit ${i}`, { "f.txt": `${rows.join("\n")}\n` });
    }
    h.push();
    await ctx.alepha.inject(CodeCommitIndex).walk(ctx.repository, [tip], 100);

    const service = ctx.alepha.inject(CodeBlameService);
    const first = await service.blame(ctx.repository, tip, "f.txt");
    expect(first.kind).toBe("row");
    if (first.kind !== "row") return;
    expect(first.row.status).toBe("pending");
    expect(first.row.steps).toBe(CodeBlameService.INLINE_STEPS);

    const done = await service.resume(ctx.repository, first.row);
    expect(done.status).toBe("ready");
    expect(ours(done.ranges)).toEqual(gitBlame(tip, "f.txt"));
  });

  it("says too large past its caps, and indexing before the index", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const tip = ctx.history.commit("big", {
      "big.txt": `${Array.from({ length: 5001 }, (_, i) => i).join("\n")}\n`,
      "small.txt": "a\n",
    });
    ctx.history.push();
    const service = ctx.alepha.inject(CodeBlameService);
    expect((await service.blame(ctx.repository, tip, "small.txt")).kind).toBe(
      "indexing",
    );
    expect((await service.blame(ctx.repository, tip, "big.txt")).kind).toBe(
      "too_large",
    );
  });
});
