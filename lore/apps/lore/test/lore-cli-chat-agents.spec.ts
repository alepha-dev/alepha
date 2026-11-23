import { AlephaLoreCli } from "@alepha/lore/cli";
import { ProjectController } from "@lore/core/api";
import { createTestMemberByProjectId } from "@lore/core/testing";
import { Alepha, AlephaError, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import {
  CliProvider,
  type CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * `lore chat agent` (#E170, #Q4200) against the real Lore app, over HTTP,
 * with a real API key: the parity spec proves the commands exist, this one
 * that they reach their actions, the playbook read from a file and the
 * avatar uploaded from a path.
 */
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

interface TestContext {
  alepha: Alepha;
  hostname: string;
}

type TestUser = { id: string; roles: string[] };

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  bootLore(alepha, ["api", "mcp"]);

  await alepha.start();

  return {
    alepha,
    hostname: alepha.inject(NodeHttpServerProvider).hostname,
  };
};

const cliFor = (ctx: TestContext, token: string, project: string) => {
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
  const fs = cli.inject(MemoryFileSystemProvider);

  const command = (path: string) => {
    const [subject, ...verbs] = path.split(" ");
    let found = cli
      .primitives<any>("$command")
      .find((it) => it.name === subject && it.hasChildren);
    for (const verb of verbs) {
      found = found?.children.find((it: any) => it.name === verb);
    }
    if (!found) {
      throw new AlephaError(`No command ${path}`);
    }
    return found;
  };

  const run = async (path: string, argv: string[] = []): Promise<string> => {
    out.clear();
    await cli.inject(CliProvider).run(command(path), { argv, root: "/work" });
    return out.text;
  };

  const json = async (path: string, argv: string[] = []) =>
    JSON.parse(await run(path, [...argv, "--output", "json"]));

  const fail = async (path: string, argv: string[] = []) => {
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

  return { cli, run, json, fail, fs };
};

// A 1x1 transparent PNG: what an avatar upload needs to be an image.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

describe("lore chat agent", () => {
  let ctx: TestContext;
  const clis: Alepha[] = [];

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    for (const cli of clis.splice(0)) {
      await cli.stop();
    }
    await ctx.alepha.stop();
  });

  const user = async () => {
    const fake = ctx.alepha.inject(FakeProvider).generate(userDataSchema);
    const created = (
      await ctx.alepha
        .inject(AdminUserController)
        .createUser.fetch(
          { body: { ...fake, roles: ["user"] } },
          { user: adminUser },
        )
    ).data;
    return { id: created.id, roles: created.roles } as TestUser;
  };

  const cliOf = async (who: TestUser, slug: string) => {
    const key = await ctx.alepha
      .inject(ApiKeyController)
      .createApiKey.fetch({ body: { name: "lore cli chat" } }, { user: who });
    const lore = cliFor(ctx, key.data.token, slug);
    clis.push(lore.cli);
    return lore;
  };

  it("creates an agent with a playbook file and an avatar, reads, edits and deletes it", async () => {
    const owner = await user();
    const project = (
      await ctx.alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: "Chat", capabilities: [{ key: "chat" }] } },
          { user: owner },
        )
    ).data;
    const lore = await cliOf(owner, project.slug);
    await lore.fs.writeFile(
      "/work/playbook.md",
      "Checking means: the feedback, then the errors.",
    );
    await lore.fs.writeFile("/work/jarvis.png", PNG);

    const created = await lore.json("chat agent create", [
      "--handle",
      "jarvis",
      "--name",
      "Jarvis",
      "--pre-prompt",
      "@playbook.md",
      "--model",
      "claude-haiku-5-5",
      "--avatar",
      "jarvis.png",
    ]);
    expect(created).toMatchObject({
      handle: "jarvis",
      name: "Jarvis",
      model: "claude-haiku-5-5",
      avatar: true,
      pre_prompt: "Checking means: the feedback, then the errors.",
    });

    const listed = await lore.json("chat agent list");
    expect(listed.agents.map((it: { handle: string }) => it.handle)).toEqual([
      "jarvis",
    ]);
    expect(await lore.run("chat agent get", ["jarvis"])).toContain(
      "Checking means",
    );

    const updated = await lore.json("chat agent update", [
      "jarvis",
      "--new-handle",
      "friday",
      "--model",
      "",
      "--no-avatar",
    ]);
    expect(updated).toMatchObject({ handle: "friday", avatar: false });
    expect(updated.model).toBeUndefined();

    const refused = await lore.fail("chat agent create", [
      "--handle",
      "lore",
      "--name",
      "Two",
    ]);
    // Reserved whether or not AI is on: this Lore has it off.
    expect(refused?.message).toContain("built-in");

    await lore.run("chat agent delete", ["friday"]);
    expect((await lore.json("chat agent list")).agents).toEqual([]);
    // With AI off, the list says no agent answers.
    expect((await lore.json("chat agent list")).enabled).toBe(false);
  });

  it("refuses a member without chat:agent", async () => {
    const owner = await user();
    const member = await user();
    const project = (
      await ctx.alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: "Chat", capabilities: [{ key: "chat" }] } },
          { user: owner },
        )
    ).data;
    await createTestMemberByProjectId(ctx.alepha, project.id, member.id);
    const lore = await cliOf(member, project.slug);

    const error = await lore.fail("chat agent create", [
      "--handle",
      "jarvis",
      "--name",
      "Jarvis",
    ]);
    expect(error).toBeDefined();
    expect((await lore.json("chat agent list")).agents).toEqual([]);
  });
});
