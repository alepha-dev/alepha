import { AlephaLoreCli } from "@alepha/lore/cli";
import { ProjectController } from "@lore/core/api";
import { FolioTableTools } from "@lore/remember/mcp";
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
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The commands that closed `GAPS` in `mcp-cli-parity.spec.ts`, against the real
 * Lore app, over HTTP, with a real API key: feedback, errors, insights,
 * releases, deployed copies, sigils, artifacts, deploys, stacks, automations
 * and a project merge.
 *
 * The parity spec proves a command exists. This one proves it reaches its
 * action: `$client` resolves by name at run time, so a command calling an
 * action the key cannot see compiles, and fails only here.
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

/**
 * A table folio from the lore CLI (#E144, #Q3515): every row and column
 * command against a booted Lore, CSV in and out, and the MCP tools reading
 * the same table back cell for cell.
 */
describe("lore folio row, column, import and export", () => {
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

  const ownProject = async () => {
    const fake = ctx.alepha.inject(FakeProvider).generate(userDataSchema);
    const user = (
      await ctx.alepha
        .inject(AdminUserController)
        .createUser.fetch(
          { body: { ...fake, roles: ["user"] } },
          { user: adminUser },
        )
    ).data;
    const owner = { id: user.id, roles: user.roles };
    const project = await ctx.alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: "Tables", capabilities: [{ key: "remember" }] } },
        { user: owner },
      );
    const key = await ctx.alepha
      .inject(ApiKeyController)
      .createApiKey.fetch(
        { body: { name: "lore cli tables" } },
        { user: owner },
      );
    const lore = cliFor(ctx, key.data.token, project.data.slug);
    clis.push(lore.cli);
    return { owner, project: project.data, lore };
  };

  const asOwner = <R>(owner: TestUser, fn: () => R): R =>
    ctx.alepha.context.run(() => {
      ctx.alepha.store.set(currentUserAtom, owner);
      return fn();
    });

  it("creates a table, adds, lists, updates and retypes rows, and agrees with the MCP tools", async () => {
    const { owner, project, lore } = await ownProject();

    const created = await lore.json("folio create", [
      "--title",
      "Hosting",
      "--summary",
      "Where to host.",
      "--type",
      "table",
      "--column",
      "Host:text",
      "--column",
      "Price:text",
      "--column",
      "Status:select:Open|Chosen",
      "--column",
      "Review:date",
    ]);
    expect(created.type).toBe("table");
    const ref = `F${created.shortId}`;

    await lore.fs.writeFile(
      "/work/rows.json",
      JSON.stringify([
        { Host: "Fly", Price: "5", Status: "open", Review: "2026-11-20" },
        { Host: "Render", Price: "7", Review: "2026-12-01" },
        { Host: "Hetzner", Price: "4", Status: "Chosen" },
      ]),
    );
    const added = await lore.json("folio row add", [
      ref,
      "--rows",
      "@rows.json",
    ]);
    expect(added.numbers).toEqual([1, 2, 3]);

    const ranged = await lore.json("folio row list", [
      ref,
      "--where",
      JSON.stringify([
        { column: "Review", from: "2026-11-01", to: "2026-11-30" },
      ]),
      "--sort",
      "Review",
    ]);
    expect(ranged.total).toBe(1);
    expect(ranged.rows[0].cells).toMatchObject({ Host: "Fly", Status: "Open" });

    const updated = await lore.json("folio row update", [
      ref,
      "--row",
      "2",
      "--cells",
      JSON.stringify({ Status: "Chosen" }),
    ]);
    expect(updated.replaced).toEqual([]);

    const retyped = await lore.json("folio column set", [
      ref,
      "--operations",
      JSON.stringify([{ op: "retype", column: "Price", type: "number" }]),
    ]);
    expect(retyped.columns.map((c: { type: string }) => c.type)).toEqual([
      "text",
      "number",
      "select",
      "date",
    ]);

    const listed = await lore.json("folio row list", [ref]);
    const viaMcp = await asOwner(owner, () =>
      (ctx.alepha.inject(FolioTableTools).folio_row_list as any).execute({
        project: project.id,
        shortId: created.shortId,
      }),
    );
    expect(viaMcp.rows).toEqual(listed.rows);
    expect(listed.rows.map((r: any) => r.cells.Price)).toEqual([5, 7, 4]);

    const text = await lore.run("folio get", [ref]);
    expect(text).toContain("Hetzner");

    const deleted = await lore.json("folio row delete", [
      ref,
      "--rows",
      "3",
      "--yes",
    ]);
    expect(deleted.deleted).toEqual([3]);
  });

  it("imports a CSV into a new table, and exports it back unchanged", async () => {
    const { lore } = await ownProject();
    const csv =
      "\uFEFFName,Amount,Due,Done\r\n" +
      '"Smith, J",12,2026-11-20,true\r\n' +
      '"Line\nbreak",3.5,2026-11-21T10:00:00.000Z,false\r\n';
    await lore.fs.writeFile("/work/budget.csv", csv);

    const imported = await lore.json("folio import", [
      "budget.csv",
      "--summary",
      "A budget.",
    ]);
    expect(imported.added).toBe(2);
    const ref = `F${imported.shortId}`;
    const folio = await lore.json("folio get", [ref]);
    expect(folio.title).toBe("budget");

    const out = await lore.run("folio export", [ref, "--csv"]);
    expect(`${out}`.trimEnd()).toBe(csv.trimEnd());

    await lore.fs.writeFile(
      "/work/more.csv",
      "name,Extra\r\nAnother,ignored\r\n",
    );
    const appended = await lore.json("folio import", [
      "more.csv",
      "--into",
      ref,
    ]);
    expect(appended.added).toBe(1);
    expect(appended.skipped).toEqual(["Extra"]);
  });
});
