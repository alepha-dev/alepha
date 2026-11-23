import { ApiKeyController } from "alepha/api/keys";
import { NodeHttpServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { CodeBrowserController, CodeCommitIndex } from "../src/api/index.ts";
import { bootCodeRepo, type CodeRepoContext } from "./fixtures/codeRepo.ts";

/**
 * Files at any revision (#Q4134): a revision found as the longest branch or
 * tag prefixing a URL's tail (a branch named `feat/x` and a path under it),
 * a tree with its README, a file as text or as binary, each entry's last
 * commit from the index, and the raw download's headers.
 */
describe("code browser: files", () => {
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

  const seed = () => {
    const h = ctx.history;
    const first = h.commit("first", {
      "README.md": "# Api\n\n![logo](docs/logo.png) [guide](docs/guide.md)\n",
      "docs/guide.md": "guide\n",
      "docs/logo.png": "\u0089PNG\u0000\u0001",
      "src/a.ts": "export const a = 1;\n",
    });
    h.git("tag", "-a", "v1", "-m", "v1");
    h.checkout("-b", "feat/x");
    const side = h.commit("side", { "src/a.ts": "export const a = 2;\n" });
    h.checkout("main");
    const second = h.commit("docs", { "docs/guide.md": "guide 2\n" });
    h.push();
    return { first, side, second };
  };

  it("resolves the longest ref, a branch with a slash included, then a sha", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const s = seed();

    const side = await api().getCodeTree.fetch(
      { params: params(), query: { at: "feat/x/src" } },
      as(),
    );
    expect(side.data.revision).toEqual({
      name: "feat/x",
      kind: "branch",
      sha: s.side,
    });
    expect(side.data.path).toBe("src");
    expect(side.data.entries.map((it) => it.path)).toEqual(["src/a.ts"]);

    const tag = await api().getCodeFile.fetch(
      { params: params(), query: { at: "v1/docs/guide.md" } },
      as(),
    );
    expect(tag.data).toMatchObject({
      revision: { name: "v1", kind: "tag", sha: s.first },
      status: "ok",
      text: "guide\n",
    });
    const bySha = await api().getCodeFile.fetch(
      { params: params(), query: { at: `${s.side}/src/a.ts` } },
      as(),
    );
    expect(bySha.data.text).toBe("export const a = 2;\n");
    expect(bySha.data.revision.kind).toBe("commit");

    // ref and path apart, as the CLI sends them; the default branch alone.
    const apart = await api().getCodeFile.fetch(
      { params: params(), query: { ref: "feat/x", path: "src/a.ts" } },
      as(),
    );
    expect(apart.data.text).toBe("export const a = 2;\n");
    const root = await api().getCodeTree.fetch(
      { params: params(), query: { at: "" } },
      as(),
    );
    expect(root.data.revision).toMatchObject({ name: "main", sha: s.second });

    await expect(
      api().getCodeTree.fetch(
        { params: params(), query: { at: "nope/src" } },
        as(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      api().getCodeFile.fetch(
        { params: params(), query: { at: "main/../src/a.ts" } },
        as(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lists folders first with the README's text, and names a binary file", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    seed();
    const root = (
      await api().getCodeTree.fetch(
        { params: params(), query: { at: "main" } },
        as(),
      )
    ).data;
    expect(root.entries.map((it) => [it.name, it.type])).toEqual([
      ["docs", "tree"],
      ["src", "tree"],
      ["README.md", "blob"],
    ]);
    expect(root.readme?.path).toBe("README.md");
    expect(root.readme?.text).toContain("![logo](docs/logo.png)");

    const logo = (
      await api().getCodeFile.fetch(
        { params: params(), query: { at: "main/docs/logo.png" } },
        as(),
      )
    ).data;
    expect(logo).toMatchObject({ status: "binary" });
    expect(logo.text).toBeUndefined();
    await expect(
      api().getCodeFile.fetch(
        { params: params(), query: { at: "main/docs" } },
        as(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("answers each entry's last commit from the index, and says when it is indexing", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    const s = seed();
    const ask = () =>
      api().getCodeTreeCommits.fetch(
        {
          params: params(),
          body: { at: "main", names: ["docs", "src", "README.md"] },
        },
        as(),
      );
    expect((await ask()).data).toEqual({ entries: [], indexing: true });

    await ctx.alepha
      .inject(CodeCommitIndex)
      .walk(ctx.repository, [s.second, s.side], 100);
    const answer = (await ask()).data;
    expect(answer.indexing).toBe(false);
    expect(
      Object.fromEntries(answer.entries.map((it) => [it.name, it.commit.sha])),
    ).toEqual({ docs: s.second, src: s.first, "README.md": s.first });

    const sub = (
      await api().getCodeTreeCommits.fetch(
        { params: params(), body: { at: "feat/x/src", names: ["a.ts"] } },
        as(),
      )
    ).data;
    expect(sub.entries.map((it) => it.commit.sha)).toEqual([s.side]);
  });

  it("downloads raw bytes as an attachment that runs nothing", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo();
    seed();
    ctx.history.commit("page", {
      "site/index.html": "<script>alert(1)</script>\n",
    });
    ctx.history.push();
    const key = await ctx.alepha
      .inject(ApiKeyController)
      .createApiKey.fetch({ body: { name: "raw" } }, as());
    const base = ctx.alepha.inject(NodeHttpServerProvider).hostname;
    const response = await fetch(
      `${base}/api/projects/${ctx.projectId}/code/repos/api/raw/main/site/index.html`,
      { headers: { authorization: `Bearer ${key.data.token}` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="index.html"/,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(await response.text()).toBe("<script>alert(1)</script>\n");

    const missing = await fetch(
      `${base}/api/projects/${ctx.projectId}/code/repos/api/raw/main/nope.txt`,
      { headers: { authorization: `Bearer ${key.data.token}` } },
    );
    expect(missing.status).toBe(404);
  });
});
