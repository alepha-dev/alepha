import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import {
  CodeCommitIndex,
  CodeIndexJobs,
  CodeRepositoryService,
  codeCommitParents,
  codeCommitPaths,
  codeCommits,
} from "../src/api/index.ts";
import { bootCodeRepo, type CodeRepoContext } from "./fixtures/codeRepo.ts";

/**
 * The commit index (#Q4132) on `LocalGitBackend`: a history with a root
 * commit, a rename, a side branch merged back, and a branch of its own,
 * indexed by a walk and by the backfill's chunks, read back by `log`.
 */
class Tables {
  commits = $repository(codeCommits);
  paths = $repository(codeCommitPaths);
  parents = $repository(codeCommitParents);
}

const history = (ctx: CodeRepoContext) => {
  const h = ctx.history;
  const c1 = h.commit("root", {
    "a.txt": "a1\n",
    "dir/b.txt": "b\n",
    "dir/sub/c.txt": "c1\n",
  });
  const c2 = h.commit("edit a", { "a.txt": "a2\n" });
  h.checkout("-b", "feat/side");
  const d1 = h.commit("side work", {
    "side.txt": "side\n",
    "dir/sub/c.txt": "c2\n",
  });
  h.checkout("main");
  h.git("mv", "dir/b.txt", "dir/renamed.txt");
  const c3 = h.commit("rename b");
  const c4 = h.commit("edit a again", { "a.txt": "a3\n" });
  const m = h.merge("feat/side", "merge side");
  h.checkout("-b", "other", c1);
  const o1 = h.commit("other work", { "other.txt": "o\n" });
  h.checkout("main");
  h.git("tag", "-a", "v1", "-m", "v1", c2);
  h.push();
  return { c1, c2, c3, c4, d1, m, o1 };
};

describe("commit index", () => {
  let ctx: CodeRepoContext;

  afterEach(async () => {
    await ctx?.stop();
  });

  const shas = (rows: Array<{ sha: string }>) => rows.map((row) => row.sha);

  it("indexes every parent, and reads a branch's history and a path's from SQL", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ probes: [Tables] });
    const s = history(ctx);
    const index = ctx.alepha.inject(CodeCommitIndex);
    const tables = ctx.alepha.inject(Tables);

    const walked = await index.walk(ctx.repository, [s.m, s.o1], 100);
    expect(walked).toEqual({ indexed: 7, remaining: false });

    const id = ctx.repository.id;
    // Newest first, the side branch's commit included, no other branch's.
    expect(shas((await index.log(id, s.m)).commits)).toEqual([
      s.m,
      s.c4,
      s.c3,
      s.d1,
      s.c2,
      s.c1,
    ]);
    // A branch's own history only: no commit of main leaks in.
    expect(shas((await index.log(id, s.o1)).commits)).toEqual([s.o1, s.c1]);
    // A tag's history stops at the tag.
    expect(shas((await index.log(id, s.c2)).commits)).toEqual([s.c2, s.c1]);

    // A file, a folder (an indexed range, not a LIKE), and a renamed file.
    expect(shas((await index.log(id, s.m, { path: "a.txt" })).commits)).toEqual(
      [s.c4, s.c2, s.c1],
    );
    expect(shas((await index.log(id, s.m, { path: "dir" })).commits)).toEqual([
      s.c3,
      s.d1,
      s.c1,
    ]);
    expect(
      shas((await index.log(id, s.m, { path: "dir/b.txt" })).commits),
    ).toEqual([s.c3, s.c1]);
    // The merge brought c.txt from its second parent unchanged: not its own.
    expect(
      shas((await index.log(id, s.m, { path: "dir/sub/c.txt" })).commits),
    ).toEqual([s.d1, s.c1]);
    // `dir` is not `dir2`: the range stops at the folder.
    expect((await index.log(id, s.m, { path: "di" })).commits).toEqual([]);

    // Paginated.
    const first = await index.log(id, s.m, { limit: 4 });
    const second = await index.log(id, s.m, { limit: 4, offset: 4 });
    expect(first.more).toBe(true);
    expect(second.more).toBe(false);
    expect([...shas(first.commits), ...shas(second.commits)]).toHaveLength(6);

    // The rows: a root commit adds everything, a rename pairs its blob, a
    // merge has its two parents as edges.
    const rootPaths = await tables.paths.findMany({
      where: { repositoryId: { eq: id }, commitSha: { eq: s.c1 } },
      orderBy: "path",
    });
    expect(rootPaths.map((row) => [row.path, row.kind])).toEqual([
      ["a.txt", "added"],
      ["dir/b.txt", "added"],
      ["dir/sub/c.txt", "added"],
    ]);
    const renamed = await tables.paths.findMany({
      where: { repositoryId: { eq: id }, commitSha: { eq: s.c3 } },
    });
    expect(renamed).toMatchObject([
      { path: "dir/renamed.txt", oldPath: "dir/b.txt", kind: "renamed" },
    ]);
    const merge = await index.find(id, s.m);
    expect(merge).toMatchObject({
      firstParent: s.c4,
      parents: [s.c4, s.d1],
      subject: "merge side",
      authorEmail: "ada@example.com",
    });
    expect(
      (
        await tables.parents.findMany({
          where: { repositoryId: { eq: id }, sha: { eq: s.m } },
          orderBy: "position",
        })
      ).map((row) => row.parentSha),
    ).toEqual([s.c4, s.d1]);
    expect(await index.byPrefix(id, s.c3.slice(0, 9))).toEqual([s.c3]);
  });

  it("re-indexes idempotently, and a half-written commit comes back from the frontier", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ probes: [Tables] });
    const s = history(ctx);
    const index = ctx.alepha.inject(CodeCommitIndex);
    const tables = ctx.alepha.inject(Tables);
    const id = ctx.repository.id;
    await index.walk(ctx.repository, [s.m, s.o1], 100);
    const before = await tables.paths.count({ repositoryId: { eq: id } });

    expect(await index.walk(ctx.repository, [s.m, s.o1], 100)).toEqual({
      indexed: 0,
      remaining: false,
    });

    // A crash between a commit's paths and its row: the row is missing.
    await tables.commits.deleteMany({
      repositoryId: { eq: id },
      sha: { eq: s.c3 },
    });
    expect(await index.frontier(id)).toEqual([s.c3]);
    expect(
      await index.walk(ctx.repository, await index.frontier(id), 10),
    ).toEqual({ indexed: 1, remaining: false });
    expect(await tables.paths.count({ repositoryId: { eq: id } })).toBe(before);
  });

  it("backfills in chunks that resume from the frontier, the tags' history included", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ probes: [Tables] });
    const s = history(ctx);
    const jobs = ctx.alepha.inject(CodeIndexJobs);
    const index = ctx.alepha.inject(CodeCommitIndex);
    const id = ctx.repository.id;
    expect(await jobs.behind(ctx.repository)).toBe(true);

    // Two commits a run: the walk stops, the frontier says where.
    const realChunk = CodeCommitIndex.CHUNK;
    (CodeCommitIndex as { CHUNK: number }).CHUNK = 2;
    try {
      let runs = 0;
      for (;;) {
        runs += 1;
        const result = await jobs.chunk(ctx.repository);
        if (!result.remaining) break;
        expect(runs).toBeLessThan(10);
      }
      expect(runs).toBe(4);
    } finally {
      (CodeCommitIndex as { CHUNK: number }).CHUNK = realChunk;
    }
    expect(await jobs.behind(ctx.repository)).toBe(false);
    expect((await index.log(id, s.m)).commits).toHaveLength(6);
    expect((await index.log(id, s.o1)).commits).toHaveLength(2);
  });

  it("deletes the index with its repository", async ({ expect }) => {
    ctx = await bootCodeRepo({ probes: [Tables] });
    const s = history(ctx);
    const index = ctx.alepha.inject(CodeCommitIndex);
    const tables = ctx.alepha.inject(Tables);
    await index.walk(ctx.repository, [s.m], 100);

    await ctx.alepha
      .inject(CodeRepositoryService)
      .delete(ctx.projectId, ctx.repository.slug);

    const where = { repositoryId: { eq: ctx.repository.id } };
    expect(await tables.commits.count(where)).toBe(0);
    expect(await tables.paths.count(where)).toBe(0);
    expect(await tables.parents.count(where)).toBe(0);
  });

  it("stays under D1's 100 bound values: a wide commit, a long known() list", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ d1: true, probes: [Tables] });
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) files[`f/${i}.txt`] = `${i}\n`;
    const tip = ctx.history.commit("wide", files);
    ctx.history.push();
    const index = ctx.alepha.inject(CodeCommitIndex);

    expect(await index.walk(ctx.repository, [tip], 10)).toEqual({
      indexed: 1,
      remaining: false,
    });
    const many = Array.from({ length: 150 }, (_, i) =>
      i.toString(16).padStart(40, "0"),
    );
    expect((await index.known(ctx.repository.id, [...many, tip])).size).toBe(1);
    expect(
      (await index.log(ctx.repository.id, tip, { path: "f" })).commits,
    ).toHaveLength(1);
  });
});
