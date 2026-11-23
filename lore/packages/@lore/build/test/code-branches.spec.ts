import { ProjectController } from "@lore/core/api";
import { afterEach, describe, it } from "vitest";

import { CodeBrowserController, CodeCommitIndex } from "../src/api/index.ts";
import { bootCodeRepo, type CodeRepoContext } from "./fixtures/codeRepo.ts";

/**
 * Branches, tags and compare (#Q4137): each branch's distance to the
 * default one from the commit index, capped; a tag peeled; two branches
 * (one named with a slash) compared from their merge base; a branch deleted
 * where it pointed, never the default one, with an activity row.
 */
describe("code browser: branches, tags and compare", () => {
  let ctx: CodeRepoContext;

  afterEach(async () => {
    await ctx?.stop();
  });

  const api = () => ctx.alepha.inject(CodeBrowserController);
  const params = () => ({
    projectId: ctx.projectId,
    slug: ctx.repository.slug,
  });
  const as = () => ({ user: ctx.owner as never });

  const seed = async () => {
    const h = ctx.history;
    const base = h.commit("base", { "a.txt": "1\n" });
    h.git("tag", "-a", "v1", "-m", "v1");
    h.checkout("-b", "feat/x");
    const x1 = h.commit("x one", { "x.txt": "1\n" });
    const x2 = h.commit("x two", { "x.txt": "2\n" });
    h.checkout("main");
    const m1 = h.commit("main one", { "a.txt": "2\n" });
    h.push();
    await ctx.alepha
      .inject(CodeCommitIndex)
      .walk(ctx.repository, [m1, x2], 100);
    return { base, x1, x2, m1 };
  };

  it("counts each branch ahead and behind the default one, and peels a tag", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const s = await seed();
    const { branches } = (
      await api().listCodeBranches.fetch({ params: params() }, as())
    ).data;
    expect(
      branches.map((it) => [
        it.name,
        it.isDefault,
        it.ahead,
        it.behind,
        it.commit?.subject,
      ]),
    ).toEqual([
      ["main", true, 0, 0, "main one"],
      ["feat/x", false, 2, 1, "x two"],
    ]);
    const { tags } = (
      await api().listCodeTags.fetch({ params: params() }, as())
    ).data;
    expect(tags).toMatchObject([
      { name: "v1", sha: s.base, commit: { subject: "base" } },
    ]);
  });

  it("compares two revisions from their merge base, a branch with a slash included", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const s = await seed();
    const compare = (
      await api().getCodeCompare.fetch(
        { params: params(), query: { base: "main", head: "feat/x" } },
        as(),
      )
    ).data;
    expect(compare).toMatchObject({
      base: { name: "main", sha: s.m1 },
      head: { name: "feat/x", sha: s.x2 },
      mergeBase: s.base,
      ahead: 2,
      behind: 1,
      aheadCapped: false,
      indexing: false,
    });
    expect(compare.commits.map((it) => it.subject)).toEqual(["x two", "x one"]);
    const diff = (
      await api().getCodeDiff.fetch(
        { params: params(), query: { from: compare.mergeBase, to: "feat/x" } },
        as(),
      )
    ).data;
    expect(diff.files.map((it) => [it.path, it.kind])).toEqual([
      ["x.txt", "added"],
    ]);
  });

  it("deletes a branch where it points, never the default one, and says so in the activity", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    await seed();
    await expect(
      api().deleteCodeBranch.fetch(
        { params: params(), query: { name: "main" } },
        as(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await api().deleteCodeBranch.fetch(
      { params: params(), query: { name: "feat/x" } },
      as(),
    );
    const refs = await ctx.backend.refs(ctx.repository.backendRef);
    expect(refs.map((it) => it.name)).not.toContain("refs/heads/feat/x");
    await expect(
      api().deleteCodeBranch.fetch(
        { params: params(), query: { name: "feat/x" } },
        as(),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const activity = await ctx.alepha
      .inject(ProjectController)
      .getProjectActivity.fetch(
        { params: { id: ctx.projectId }, query: { size: 20 } },
        as(),
      );
    expect(
      activity.data.content.find((row) => row.action === "delete-branch"),
    ).toMatchObject({ type: "code", resourceId: "api" });
  });

  it("refuses a branch deletion to a Viewer, who holds no code:write", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    await seed();
    const viewer = await ctx.addMember("viewer");
    await expect(
      api().deleteCodeBranch.fetch(
        { params: params(), query: { name: "feat/x" } },
        { user: viewer as never },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
