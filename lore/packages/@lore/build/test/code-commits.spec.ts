import { CommitReferenceRegistry } from "@lore/core/api";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import { CodeBrowserController, CodeCommitIndex } from "../src/api/index.ts";
import { bootCodeRepo, type CodeRepoContext } from "./fixtures/codeRepo.ts";

/**
 * Commits (#Q4136): a branch's history and a path's from the index, each
 * commit with the quests Plan says it landed on (through core's registry,
 * never Plan itself) and its author as a member when the email matches,
 * and one commit's page with its parents.
 */
class Users {
  rows = $repository(users);
}

describe("code browser: commits", () => {
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

  it("lists a branch's history and a path's, with quests and members, a page at a time", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const h = ctx.history;
    const shas = [h.commit("first", { "a.txt": "1\n", "docs/x.md": "x\n" })];
    for (let i = 2; i <= 33; i++)
      shas.push(h.commit(`edit ${i}`, { "a.txt": `${i}\n` }));
    const docs = h.commit("docs #Q7", { "docs/x.md": "y\n" });
    h.push();
    const asked: string[][] = [];
    ctx.alepha
      .inject(CommitReferenceRegistry)
      .registerReader(async (_id, list) => {
        asked.push(list);
        return new Map(
          list.map((sha) => [
            sha,
            sha === docs
              ? [{ number: 7, title: "Docs", status: "accepted" }]
              : [],
          ]),
        );
      });

    const indexing = await api().getCodeLog.fetch(
      { params: params(), query: { at: "main" } },
      as(),
    );
    expect(indexing.data).toMatchObject({ indexing: true, commits: [] });

    await ctx.alepha.inject(CodeCommitIndex).walk(ctx.repository, [docs], 100);
    const first = (
      await api().getCodeLog.fetch(
        { params: params(), query: { at: "main" } },
        as(),
      )
    ).data;
    expect(first.indexing).toBe(false);
    expect(first.commits).toHaveLength(30);
    expect(first.more).toBe(true);
    expect(first.commits[0]).toMatchObject({
      sha: docs,
      subject: "docs #Q7",
      quests: [{ number: 7, title: "Docs" }],
    });
    // One quests lookup for the whole page.
    expect(asked.at(-1)).toHaveLength(30);
    const second = (
      await api().getCodeLog.fetch(
        { params: params(), query: { at: "main", page: 1 } },
        as(),
      )
    ).data;
    expect(second.commits.map((it) => it.sha)).toEqual(
      shas.slice(0, 4).toReversed(),
    );
    expect(second.more).toBe(false);

    const folder = (
      await api().getCodeLog.fetch(
        { params: params(), query: { ref: "main", path: "docs" } },
        as(),
      )
    ).data;
    expect(folder.commits.map((it) => it.subject)).toEqual([
      "docs #Q7",
      "first",
    ]);
  });

  it("answers one commit by a short sha, with its parents and quests", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const h = ctx.history;
    const root = h.commit("root", { "a.txt": "1\n" });
    const tip = h.commit("subject line\n\nthe body", { "a.txt": "2\n" });
    h.push();
    await ctx.alepha.inject(CodeCommitIndex).walk(ctx.repository, [tip], 10);

    const commit = (
      await api().getCodeCommit.fetch(
        { params: { ...params(), sha: tip.slice(0, 8) } },
        as(),
      )
    ).data;
    expect(commit).toMatchObject({
      sha: tip,
      parents: [root],
      subject: "subject line",
      body: "the body",
      author: { name: "Ada Lore", email: "ada@example.com" },
      quests: [],
    });
    const rootCommit = (
      await api().getCodeCommit.fetch(
        { params: { ...params(), sha: root } },
        as(),
      )
    ).data;
    expect(rootCommit.parents).toEqual([]);
    await expect(
      api().getCodeCommit.fetch(
        { params: { ...params(), sha: "f".repeat(40) } },
        as(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("names the member behind an author email, once a page", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ probes: [Users] });
    await ctx.alepha
      .inject(Users)
      .rows.updateById(ctx.owner.id, { email: "ada@example.com" });
    const tip = ctx.history.commit("by ada", { "a.txt": "1\n" });
    ctx.history.push();
    await ctx.alepha.inject(CodeCommitIndex).walk(ctx.repository, [tip], 10);

    const log = (
      await api().getCodeLog.fetch({ params: params(), query: {} }, as())
    ).data;
    expect(log.commits[0]?.member?.userId).toBe(ctx.owner.id);
    const commit = (
      await api().getCodeCommit.fetch(
        { params: { ...params(), sha: tip } },
        as(),
      )
    ).data;
    expect(commit.member?.userId).toBe(ctx.owner.id);
  });
});
