import { AlephaLoreCli } from "@alepha/lore/cli";
import { ProjectController } from "@lore/core/api";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha, AlephaError } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { OrganizationRankController } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import {
  CliProvider,
  type CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Someone invited on the Viewer rank, as the project seeds it, working with a project's memory
 * from the terminal and from an agent: the `lore` CLI and MCP, both with a
 * personal API key, against the real Lore over HTTP.
 *
 * Reads work. A write is refused with "read-only in this project", in the
 * server's own sentence, which the CLI prints and MCP returns as the tool's
 * error. `project_context` says so before the agent tries.
 */

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  const repos = alepha.inject(CoreTestEntities);
  await alepha.start();

  const hostname = alepha.inject(NodeHttpServerProvider).hostname;
  const users = alepha.inject(UserService);
  const projects = alepha.inject(ProjectController);
  const rankApi = alepha.inject(OrganizationRankController);
  const keys = alepha.inject(ApiKeyController);

  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;
  const person = async (name: string) =>
    (await users.createUser({ username: name, email: `${name}@example.com` }))
      .id;
  const tokenOf = async (id: string) =>
    (await keys.createApiKey.fetch({ body: { name: "lore cli" } }, as(id))).data
      .token;

  const owner = await person("owner");
  const project = (
    await projects.createProject.fetch({ body: { title: "Open" } }, as(owner))
  ).data;
  const organizationId = (await repos.projects.findById(project.id))!
    .organizationId!;
  const viewer = await person("viewer");
  await repos.members.create({ organizationId, userId: viewer });
  await rankApi.assignOrganizationRank.fetch(
    { params: { organizationId, userId: viewer }, body: { key: "viewer" } },
    as(owner),
  );

  return {
    alepha,
    hostname,
    projects,
    as,
    person,
    tokenOf,
    owner,
    viewer,
    project,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

/**
 * The CLI's own container, holding the key the way a shell holds
 * `LORE_API_KEY` (the same shape as `lore-cli-work.spec.ts`).
 */
const cliFor = (ctx: Ctx, token: string, project: string) => {
  const cli = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      LORE_API_KEY: token,
      LORE_URL: ctx.hostname,
      LORE_PROJECT: project,
      HOME: "/nonexistent",
    },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(AlephaLoreCli);
  const out = cli.inject(MemoryOutputProvider);

  const command = (path: string) => {
    const [subject, ...verbs] = path.split(" ");
    let found = cli
      .primitives<any>("$command")
      .find((it) => it.name === subject && it.hasChildren);
    for (const verb of verbs) {
      found = found?.children.find((it: any) => it.name === verb);
    }
    if (!found) throw new AlephaError(`No command ${path}`);
    return found;
  };

  const run = async (path: string, argv: string[]): Promise<string> => {
    out.clear();
    await cli.inject(CliProvider).run(command(path), { argv, root: "/work" });
    return out.text;
  };

  const fail = async (path: string, argv: string[]) => {
    out.clear();
    const error = await cli
      .inject(CliProvider)
      .run(command(path), { argv, root: "/work" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    return error as CommandError | undefined;
  };

  return { cli, run, fail };
};

const mcpFor = (ctx: Ctx, token: string) => {
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${ctx.hostname}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const data = (await response.json()) as {
      error?: { message: string };
      result?: { isError?: boolean; content?: Array<{ text: string }> };
    };
    const text = data.error?.message ?? data.result?.content?.[0]?.text ?? "";
    return {
      refused: !!data.error || data.result?.isError === true,
      text,
      json: () => JSON.parse(text),
    };
  };
};

describe("a viewer in the lore CLI and over MCP", () => {
  let ctx: Ctx;
  const clis: Alepha[] = [];

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    for (const cli of clis.splice(0)) await cli.stop();
    await ctx.alepha.stop();
  });

  /**
   * The owner's CLI writes what the viewer then reads.
   */
  const seed = async () => {
    const owner = cliFor(ctx, await ctx.tokenOf(ctx.owner), ctx.project.slug);
    clis.push(owner.cli);
    const quest = JSON.parse(
      await owner.run("quest create", [
        "--title",
        "Fix the parser",
        "--area",
        "core",
        "--priority",
        "medium",
        "--output",
        "json",
      ]),
    );
    await owner.run("folio create", [
      "--title",
      "The plan",
      "--summary",
      "What we will do.",
      "--content",
      "Bravo body",
    ]);
    return { quest };
  };

  describe("the lore CLI", () => {
    it("reads quests and folios", async ({ expect }) => {
      const { quest } = await seed();
      const lore = cliFor(ctx, await ctx.tokenOf(ctx.viewer), ctx.project.slug);
      clis.push(lore.cli);

      expect(await lore.run("quest get", [`Q${quest.shortId}`])).toContain(
        "Fix the parser",
      );
      expect(await lore.run("quest list", [])).toContain("Fix the parser");
      expect(await lore.run("folio search", ["bravo"])).toContain("The plan");

      // Orientation says it before the first write, as project_context does.
      const context = await lore.run("project context", []);
      expect(context).toContain("Viewer");
      expect(context).toMatch(/Access:?\s+read-only/);
    });

    it("refuses a write with exit 4, saying read-only in this project", async ({
      expect,
    }) => {
      await seed();
      const lore = cliFor(ctx, await ctx.tokenOf(ctx.viewer), ctx.project.slug);
      clis.push(lore.cli);

      const refused = await lore.fail("quest create", [
        "--title",
        "From outside",
        "--area",
        "core",
        "--priority",
        "medium",
      ]);

      expect(refused?.data.exitCode).toBe(4);
      expect(refused?.message).toContain(`Project ${ctx.project.slug}:`);
      expect(refused?.message).toContain("read-only in this project");
      expect(refused?.message).toContain("quest:create");
    });
  });

  describe("MCP", () => {
    it("states the rank and that it is read-only in project_context", async ({
      expect,
    }) => {
      const mcp = mcpFor(ctx, await ctx.tokenOf(ctx.viewer));

      const viewer = (
        await mcp("project_context", { project: ctx.project.id })
      ).json();
      expect(viewer.rank).toEqual({ key: "viewer", name: "Viewer" });
      expect(viewer.readOnly).toBe(true);

      const owner = (
        await mcpFor(ctx, await ctx.tokenOf(ctx.owner))("project_context", {
          project: ctx.project.id,
        })
      ).json();
      expect(owner.readOnly).toBe(false);
    });

    it("runs the read tools", async ({ expect }) => {
      const { quest } = await seed();
      const mcp = mcpFor(ctx, await ctx.tokenOf(ctx.viewer));
      const project = { project: ctx.project.id };

      for (const [tool, args] of [
        ["project_info", project],
        ["quest_get", { ...project, shortId: quest.shortId }],
        ["quest_list", project],
        ["folio_list", project],
        ["folio_search", { ...project, query: "bravo" }],
        ["epic_list", project],
        ["release_list", project],
      ] as const) {
        const result = await mcp(tool, args);
        expect(result.refused, `${tool}: ${result.text}`).toBe(false);
      }
    });

    it("refuses a write tool, saying read-only in this project", async ({
      expect,
    }) => {
      await seed();
      const mcp = mcpFor(ctx, await ctx.tokenOf(ctx.viewer));

      const refused = await mcp("quest_create", {
        project: ctx.project.id,
        title: "From outside",
        description: "Filed by a viewer.",
        area: "core",
        priority: "medium",
      });

      expect(refused.refused).toBe(true);
      expect(refused.text).toContain("read-only in this project");
    });
  });

  describe("a viewer's personal API key", () => {
    it("reaches no more than the viewer's ranks", async ({ expect }) => {
      const token = await ctx.tokenOf(ctx.viewer);
      const mcp = mcpFor(ctx, token);

      // A project the viewer is not in: the key is the account, and the
      // account is no member there.
      const other = await ctx.person("other");
      const elsewhere = (
        await ctx.projects.createProject.fetch(
          { body: { title: "Closed" } },
          ctx.as(other),
        )
      ).data;
      expect(
        (await mcp("project_context", { project: elsewhere.id })).refused,
      ).toBe(true);

      // A folio write in the viewer's own project: the key acts as the
      // viewer, so the rank refuses it.
      const write = await mcp("folio_create", {
        project: ctx.project.id,
        title: "From outside",
        summary: "No.",
        content: "No.",
      });
      expect(write.refused).toBe(true);
      expect(write.text).toContain("read-only in this project");
    });
  });
});
