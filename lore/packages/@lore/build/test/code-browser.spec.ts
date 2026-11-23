import { ProjectCapabilityController } from "@lore/core/api";
import { afterEach, describe, it } from "vitest";

import {
  CodeBrowserController,
  CodeIndexJobs,
  CodeRepositoryController,
  GitBrowserRedirect,
} from "../src/api/index.ts";
import { bootCodeRepo, type CodeRepoContext } from "./fixtures/codeRepo.ts";

/**
 * The code browser's first reads (#Q4133): the repository list with each
 * default branch's last commit, a repository's header, the 404 with Build's
 * `repositories` off, and where a browser opening a `.git` URL lands.
 */
describe("code browser: repositories", () => {
  let ctx: CodeRepoContext;

  afterEach(async () => {
    await ctx?.stop();
  });

  const get = (slug = ctx.repository.slug) =>
    ctx.alepha
      .inject(CodeBrowserController)
      .getCodeRepository.fetch(
        { params: { projectId: ctx.projectId, slug } },
        { user: ctx.owner as never },
      );
  const list = () =>
    ctx.alepha
      .inject(CodeRepositoryController)
      .listCodeRepositories.fetch(
        { params: { projectId: ctx.projectId } },
        { user: ctx.owner as never },
      );

  it("answers an empty repository with no head, and lists it", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const detail = (await get()).data;
    expect(detail).toMatchObject({
      branches: [],
      tags: [],
      indexing: false,
      repository: { slug: "api", defaultBranch: "main" },
    });
    expect(detail.head).toBeUndefined();
    const listed = (await list()).data.repositories;
    expect(listed.map((it) => [it.slug, it.lastCommit])).toEqual([
      ["api", undefined],
    ]);
  });

  it("answers branches, peeled tags and the default branch's last commit, and starts the index", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const first = ctx.history.commit("first", { "a.txt": "a\n" });
    ctx.history.git("tag", "-a", "v1", "-m", "v1");
    ctx.history.checkout("-b", "feat/x");
    const side = ctx.history.commit("side", { "b.txt": "b\n" });
    ctx.history.checkout("main");
    const tip = ctx.history.commit("second", { "a.txt": "aa\n" });
    ctx.history.push();
    const started: string[] = [];
    const jobs = ctx.alepha.inject(CodeIndexJobs);
    jobs.start = async (id: string) => {
      started.push(id);
    };

    const detail = (await get()).data;
    expect(detail.branches).toEqual([
      { name: "feat/x", sha: side },
      { name: "main", sha: tip },
    ]);
    expect(detail.tags).toEqual([{ name: "v1", sha: first }]);
    expect(detail.head).toMatchObject({
      sha: tip,
      subject: "second",
      authorName: "Ada Lore",
      parents: [first],
    });
    // Pushed by path, so nothing indexed it: opening the page starts it.
    expect(detail.indexing).toBe(true);
    expect(started).toEqual([ctx.repository.id]);

    const listed = (await list()).data.repositories;
    expect(listed[0]?.lastCommit?.sha).toBe(tip);
  });

  it("404s every read with Build's repositories off, and an unknown repository", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    await expect(get("nope")).rejects.toMatchObject({ status: 404 });
    await ctx.alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: ctx.projectId, key: "build" },
        body: {
          enabled: true,
          options: { repositories: false, quality: true },
        },
      },
      { user: ctx.owner as never },
    );
    await expect(get()).rejects.toMatchObject({ status: 404 });
    await expect(list()).rejects.toMatchObject({ status: 404 });
  });

  it("sends a browser opening a .git URL to its page, and leaves git alone", ({
    expect,
  }) => {
    const html = "text/html,application/xhtml+xml";
    expect(
      GitBrowserRedirect.targetOf("GET", "/alepha.git", html, "Mozilla/5.0"),
    ).toBe("/alepha/code");
    expect(
      GitBrowserRedirect.targetOf("GET", "/alepha/api.git", html, "Mozilla"),
    ).toBe("/alepha/code/api");
    expect(
      GitBrowserRedirect.targetOf("GET", "/alepha.git", html, "git/2.50.1"),
    ).toBeUndefined();
    expect(
      GitBrowserRedirect.targetOf("GET", "/alepha.git", "*/*", "Mozilla"),
    ).toBeUndefined();
    expect(
      GitBrowserRedirect.targetOf(
        "GET",
        "/alepha.git/info/refs",
        html,
        "Mozilla",
      ),
    ).toBeUndefined();
    expect(
      GitBrowserRedirect.targetOf("POST", "/alepha.git", html, "Mozilla"),
    ).toBeUndefined();
    expect(
      GitBrowserRedirect.targetOf("GET", "/alepha/quests", html, "Mozilla"),
    ).toBeUndefined();
  });
});
