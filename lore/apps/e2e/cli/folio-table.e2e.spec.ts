/**
 * A table folio through the built `lore` binary and through MCP, against one
 * real Lore (#E144, #Q3522): rows written and reshaped from the command line,
 * then read back by the MCP tools an agent calls, and both surfaces agree on
 * every cell.
 *
 * Boots `apps/lore/dist` and runs `packages/@alepha/lore/dist/bin`, so it
 * needs `yarn build` first. Nothing here reads the machine's environment: the
 * CLI gets its URL, key and project from the test, and `LORE_PROJECT` is set,
 * never inherited.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FolioCsv } from "@alepha/lore/csv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LORE_DIR = join(ROOT, "apps", "lore");
const BIN = join(ROOT, "packages/@alepha/lore/dist/bin/index.js");
const PASSWORD = "GoodPassw0rd!";

interface Registry {
  prefix?: string;
  actions: Record<string, { path: string; method?: string }>;
}

const freePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });

const json = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as T;
};

describe("a table folio from the CLI and over MCP", () => {
  let child: ChildProcess;
  let dataDir: string;
  let url: string;
  let output = "";
  let token: string;
  let key: string;
  let projectId: number;
  let registry: Registry;

  const call = async <T>(
    action: string,
    options: { params?: Record<string, string | number>; body?: unknown },
  ): Promise<T> => {
    const entry = registry.actions[action];
    if (!entry) throw new Error(`no API action named ${action}`);
    let path = entry.path;
    for (const [name, value] of Object.entries(options.params ?? {})) {
      path = path.replace(`:${name}`, encodeURIComponent(String(value)));
    }
    return json<T>(
      await fetch(`${url}${registry.prefix ?? "/api"}${path}`, {
        method: entry.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );
  };

  const lore = (
    args: string[],
    stdin?: string,
  ): Promise<{ code: number; out: string; err: string }> =>
    new Promise((done, reject) => {
      const cli = spawn("node", [BIN, ...args], {
        env: {
          ...process.env,
          // vitest's NODE_ENV=test would boot the CLI on an in-memory file
          // system.
          NODE_ENV: "development",
          LORE_URL: url,
          LORE_API_KEY: key,
          LORE_PROJECT: String(projectId),
          CLAUDECODE: "",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      cli.stdout.on("data", (d) => (out += d));
      cli.stderr.on("data", (d) => (err += d));
      cli.on("error", reject);
      cli.on("close", (code) => done({ code: code ?? -1, out, err }));
      cli.stdin.end(stdin ?? "");
    });

  const mcp = async <T>(name: string, args: Record<string, unknown>) => {
    const answer = await json<{
      result?: { isError?: boolean; content?: Array<{ text: string }> };
      error?: { message: string };
    }>(
      await fetch(`${url}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    const text = answer.error?.message ?? answer.result?.content?.[0]?.text;
    if (answer.error || answer.result?.isError) {
      throw new Error(`${name} refused: ${text}`);
    }
    return JSON.parse(text ?? "null") as T;
  };

  beforeAll(async () => {
    for (const built of [join(LORE_DIR, "dist"), BIN]) {
      if (!existsSync(built)) {
        throw new Error(`${built} is missing: run \`yarn build\` first`);
      }
    }
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), "lore-folio-table-e2e-"));
    child = spawn("node", ["dist"], {
      cwd: LORE_DIR,
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        SERVER_HOST: "127.0.0.1",
        DATABASE_URL: ":memory:",
        DATA_DIR: dataDir,
        APP_SECRET: "folio-table-e2e-secret",
        REGISTRATION_IP_MAX_ATTEMPTS: "1000",
        LOG_LEVEL: "warn",
        LOG_FORMAT: "json",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    const started = Date.now();
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`Lore exited ${child.exitCode}:\n${output}`);
      }
      const up = await fetch(`${url}/version`).then(
        (res) => res.ok,
        () => false,
      );
      if (up) break;
      if (Date.now() - started > 60_000) {
        throw new Error(`Lore did not listen:\n${output.slice(-2000)}`);
      }
      await new Promise((wait) => setTimeout(wait, 250));
    }

    const email = `ana-${Date.now()}@example.com`;
    const intent = await json<{ intentId: string }>(
      await fetch(`${url}/api/users/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, username: "ana" }),
      }),
    );
    await json(
      await fetch(`${url}/api/users/register/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: intent.intentId }),
      }),
    );
    const tokens = await json<{ access_token: string; api: Registry }>(
      await fetch(`${url}/_auth/token?provider=credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: email, password: PASSWORD }),
      }),
    );
    token = tokens.access_token;
    registry = tokens.api;
    projectId = (
      await call<{ id: number }>("createProject", {
        body: { title: "Hosting" },
      })
    ).id;
    key = (
      await call<{ token: string }>("createApiKey", {
        body: { name: "folio table e2e" },
      })
    ).token;
  }, 120_000);

  afterAll(() => {
    child?.kill();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("agrees on every cell, written by the CLI and read by MCP", async () => {
    const created = await lore([
      "folio",
      "create",
      "--title",
      "Hosting options",
      "--summary",
      "Where the app could run, and for how much.",
      "--type",
      "table",
      "--column",
      "Host:text",
      "--column",
      "Price:text",
      "--column",
      "Since:date",
      "--output",
      "json",
    ]);
    expect(created.code, created.err + created.out).toBe(0);
    const folio = `F${(JSON.parse(created.out) as { shortId: number }).shortId}`;

    const rows = [
      { Host: "Fly", Price: "5", Since: "2026-01-12" },
      { Host: "Render, EU", Price: "7.5", Since: "2026-02-03" },
      { Host: 'Hetzner "CX22"', Price: "4", Since: "2026-03-20" },
      { Host: "Railway", Price: "five", Since: "2026-04-30" },
      { Host: "Cloudflare", Price: "0", Since: null },
    ];
    const added = await lore(
      ["folio", "row", "add", folio, "--rows", "@-"],
      JSON.stringify(rows),
    );
    expect(added.code, added.err + added.out).toBe(0);

    const spring = await lore([
      "folio",
      "row",
      "list",
      folio,
      "--where",
      JSON.stringify([
        { column: "Since", from: "2026-02-01", to: "2026-04-30" },
      ]),
      "--sort",
      "Since",
      "--output",
      "json",
    ]);
    expect(spring.code, spring.err + spring.out).toBe(0);
    expect(
      (
        JSON.parse(spring.out) as { rows: Array<{ cells: { Host: string } }> }
      ).rows.map((row) => row.cells.Host),
    ).toEqual(["Render, EU", 'Hetzner "CX22"', "Railway"]);

    const retyped = await lore([
      "folio",
      "column",
      "set",
      folio,
      "--operations",
      JSON.stringify([{ op: "retype", column: "Price", type: "number" }]),
    ]);
    expect(retyped.code, retyped.err + retyped.out).toBe(0);

    const listed = await lore([
      "folio",
      "row",
      "list",
      folio,
      "--limit",
      "100",
      "--output",
      "json",
    ]);
    expect(listed.code, listed.err + listed.out).toBe(0);
    const fromCli = (
      JSON.parse(listed.out) as {
        rows: Array<{ number: number; cells: Record<string, unknown> }>;
      }
    ).rows;

    const shortId = Number(folio.slice(1));
    const fromMcp = await mcp<{
      total: number;
      rows: Array<{ number: number; cells: Record<string, unknown> }>;
    }>("folio_row_list", { project: projectId, shortId, limit: 100 });
    expect(fromMcp.total).toBe(rows.length);
    const got = await mcp<{
      type: string;
      columns: Array<{ name: string; type: string }>;
      rowCount: number;
    }>("folio_get", { project: projectId, shortId });
    expect(got.type).toBe("table");
    expect(got.columns).toEqual([
      { name: "Host", type: "text" },
      { name: "Price", type: "number" },
      { name: "Since", type: "date" },
    ]);

    // Every cell, both surfaces: the retype read "five" as empty and the
    // numbers as numbers, the same on each.
    expect(fromCli.map((row) => [row.number, row.cells])).toEqual(
      fromMcp.rows.map((row) => [row.number, row.cells]),
    );
    expect(fromMcp.rows.map((row) => row.cells.Price)).toEqual([
      5,
      7.5,
      4,
      null,
      0,
    ]);

    const exported = await lore(["folio", "export", folio, "--csv"]);
    expect(exported.code, exported.err).toBe(0);
    const csv = new FolioCsv().parse(exported.out);
    expect(csv.rows[0]).toEqual(["Host", "Price", "Since"]);
    expect(csv.rows.slice(1)).toEqual(
      fromMcp.rows.map((row) =>
        ["Host", "Price", "Since"].map((name) => {
          const value = row.cells[name] as string | number | boolean | null;
          return value === null || value === undefined ? "" : String(value);
        }),
      ),
    );
  });
});
