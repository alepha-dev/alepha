/**
 * Plan's Requirements through the built `lore` binary, against one real Lore
 * (#E153, #Q3776): a persona, a use case and a requirement created from the
 * command line, a criterion linked, a run recorded, then the requirement,
 * its coverage and the Verify prompt read back, as an agent would.
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

describe("requirements from the CLI", () => {
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

  beforeAll(async () => {
    for (const built of [join(LORE_DIR, "dist"), BIN]) {
      if (!existsSync(built)) {
        throw new Error(`${built} is missing: run \`yarn build\` first`);
      }
    }
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), "lore-requirements-e2e-"));
    child = spawn("node", ["dist"], {
      cwd: LORE_DIR,
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        SERVER_HOST: "127.0.0.1",
        DATABASE_URL: ":memory:",
        DATA_DIR: dataDir,
        APP_SECRET: "requirements-e2e-secret",
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
        body: { title: "Acme" },
      })
    ).id;
    await call("setCapability", {
      params: { projectId, key: "plan" },
      body: {
        enabled: true,
        options: { epics: true, releases: true, requirements: true },
      },
    });
    key = (
      await call<{ token: string }>("createApiKey", {
        body: { name: "requirements e2e" },
      })
    ).token;
  }, 120_000);

  afterAll(() => {
    child?.kill();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates a persona, a use case and a requirement, links a criterion and records a run", async () => {
    const persona = await lore([
      "persona",
      "create",
      "--name",
      "Léa",
      "--kind",
      "human",
      "--role",
      "Shop manager",
    ]);
    expect(persona.code, persona.err).toBe(0);
    expect(persona.out).toContain("A1");

    const useCase = await lore([
      "usecase",
      "create",
      "--title",
      "Apply a promo code",
      "--actor",
      "A1",
      "--criteria",
      JSON.stringify([
        { text: "The discount shows before payment" },
        { text: "An expired code is refused" },
      ]),
    ]);
    expect(useCase.code, useCase.err).toBe(0);
    expect(useCase.out).toContain("U1");

    const requirement = await lore([
      "requirement",
      "create",
      "--statement",
      "The discount is visible before payment",
      "--priority",
      "must",
    ]);
    expect(requirement.code, requirement.err).toBe(0);
    expect(requirement.out).toContain("S1");

    const link = await lore([
      "criterion",
      "link",
      "--usecase",
      "U1",
      "--key",
      "C1",
      "--requirement",
      "S1",
    ]);
    expect(link.code, link.err).toBe(0);

    const run = await lore([
      "usecase",
      "run",
      "record",
      "U1",
      "--by",
      "agent",
      "--result",
      "C1=passed,C2=passed",
    ]);
    expect(run.code, run.err).toBe(0);

    const read = await lore(["requirement", "get", "S1"]);
    expect(read.code, read.err).toBe(0);
    expect(read.out).toContain("verified");
    expect(read.out).toContain("U1 C1");
  });

  it("reads the coverage and prints the Verify prompt", async () => {
    const coverage = await lore(["requirement", "coverage"]);
    expect(coverage.code, coverage.err).toBe(0);
    expect(coverage.out).toContain("1 / 1 verified");

    const prompt = await lore(["usecase", "prompt", "U1", "--mode", "test"]);
    expect(prompt.code, prompt.err).toBe(0);
    expect(prompt.out).toContain("Apply a promo code");
    expect(prompt.out).toContain("usecase_run_record");

    const listed = await lore(["persona", "list", "--output", "json"]);
    expect(listed.code, listed.err).toBe(0);
    expect(JSON.parse(listed.out)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Léa" })]),
    );
  });
});
