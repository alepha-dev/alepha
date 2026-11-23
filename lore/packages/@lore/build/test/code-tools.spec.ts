import { JobKeyService } from "@lore/core/api";
import { ApiKeyController } from "alepha/api/keys";
import { NodeHttpServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { CodeCommitIndex, CodeRepositoryService } from "../src/api/index.ts";
import {
  bootCodeRepo,
  type CodeRepoContext,
  GitHistory,
} from "./fixtures/codeRepo.ts";

/**
 * Agents read code (#Q4139): the six tools over `/mcp`, sized for a
 * context window, and a job key reading the one repository it is pinned to.
 */
describe("code read tools", () => {
  let ctx: CodeRepoContext;

  afterEach(async () => {
    await ctx?.stop();
  });

  const call = async (
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const base = ctx.alepha.inject(NodeHttpServerProvider).hostname;
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: { project: ctx.projectId, ...args } },
      }),
    });
    const data = (await response.json()) as {
      result?: {
        isError?: boolean;
        structuredContent?: any;
        content?: Array<{ text: string }>;
      };
      error?: { message: string };
    };
    if (data.error || data.result?.isError) {
      return {
        error:
          data.error?.message ?? data.result?.content?.[0]?.text ?? "error",
      };
    }
    return {
      value:
        data.result?.structuredContent ??
        JSON.parse(data.result?.content?.[0]?.text ?? "null"),
    };
  };

  const seed = async () => {
    const h = ctx.history;
    const big = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const first = h.commit("first #Q3", {
      "src/a.ts": "a\n",
      "big.txt": `${big}\n`,
    });
    const tip = h.commit("second", { "src/a.ts": "a\nb\n" });
    h.push();
    await ctx.alepha.inject(CodeCommitIndex).walk(ctx.repository, [tip], 10);
    return { first, tip };
  };

  it("answers a tree, a file 200 lines at a time, a log, a commit, a diff and a blame", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ mcp: true });
    const s = await seed();
    const { token } = (
      await ctx.alepha
        .inject(ApiKeyController)
        .createApiKey.fetch(
          { body: { name: "mcp" } },
          { user: ctx.owner as never },
        )
    ).data;

    const tree = await call(token, "code_tree", {});
    expect(tree.value.entries.map((it: any) => [it.name, it.type])).toEqual([
      ["src", "dir"],
      ["big.txt", "file"],
    ]);

    const file = await call(token, "code_file", { path: "big.txt" });
    expect(file.value).toMatchObject({
      total_lines: 250,
      start_line: 1,
      end_line: 200,
    });
    expect(file.value.text.split("\n")[0]).toBe("1\tline 1");
    expect(file.value.next).toMatch(/start_line 201/);
    const rest = await call(token, "code_file", {
      path: "big.txt",
      start_line: 201,
    });
    expect(rest.value).toMatchObject({ start_line: 201, end_line: 250 });
    expect(rest.value.next).toBeUndefined();

    const log = await call(token, "code_log", { path: "src/a.ts" });
    expect(log.value.commits.map((it: any) => it.subject)).toEqual([
      "second",
      "first #Q3",
    ]);

    const commit = await call(token, "code_commit", { sha: s.tip.slice(0, 8) });
    expect(commit.value).toMatchObject({
      sha: s.tip,
      files: [
        { path: "src/a.ts", kind: "modified", additions: 1, deletions: 0 },
      ],
    });

    const diff = await call(token, "code_diff", {
      from: s.first,
      to: "main",
      path: "src/a.ts",
    });
    expect(diff.value.diff).toBe("@@ -1,1 +1,2 @@\n a\n+b");

    const blame = await call(token, "code_blame", { path: "src/a.ts" });
    expect(blame.value).toMatchObject({ status: "ready", pending: false });
    expect(
      blame.value.runs.map((it: any) => [it.start_line, it.end_line, it.sha]),
    ).toEqual([
      [1, 1, s.first],
      [2, 2, s.tip],
    ]);
  });

  it("lets a job key read the repository it is pinned to, and 404s another", async ({
    expect,
  }) => {
    ctx = await bootCodeRepo({ mcp: true });
    await seed();
    const other = await ctx.alepha.inject(CodeRepositoryService).create({
      projectId: ctx.projectId,
      slug: "web",
    });
    const web = new GitHistory(
      `${ctx.dir}/web-work`,
      ctx.backend.pathOf(other.backendRef),
    );
    web.commit("web root", { "index.html": "<p>hi</p>\n" });
    web.push();

    const token = await ctx.alepha.inject(JobKeyService).mint(
      {
        id: crypto.randomUUID(),
        projectId: ctx.projectId,
        kind: "agent",
        status: "running",
        startedBy: ctx.owner.id,
        queuedAt: new Date().toISOString(),
        input: { profile: "read", maxTurns: 10, timeoutSeconds: 600 },
      } as never,
      { tools: ["code_tree", "code_file"], repositoryId: ctx.repository.id },
    );

    const pinned = await call(token, "code_tree", { repo: "api" });
    expect(pinned.error).toBeUndefined();
    expect(pinned.value.entries.length).toBeGreaterThan(0);
    const elsewhere = await call(token, "code_tree", { repo: "web" });
    expect(elsewhere.error).toMatch(/not found|no repository/i);
    // Not allowlisted for the key: refused whatever the repository.
    const unlisted = await call(token, "code_log", { repo: "api" });
    expect(unlisted.error).toBeDefined();
  });
});
