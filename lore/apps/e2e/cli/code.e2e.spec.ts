/**
 * Lore's git repositories through the built `lore` binary, against one real
 * Lore on Node (#Q3934, #E162): create a repository, push to it and clone it
 * back with nothing but plain git and the CLI as its credential helper, from
 * a clean HOME whose global git config already names a STORING helper, the
 * way a machine with a keychain does.
 *
 * What it pins: the helper answers git, and the empty `helper =` entry
 * `lore` installs ahead of it keeps the storing helper from ever being asked,
 * so no token lands on disk.
 *
 * Boots `apps/lore/dist` and runs `packages/@alepha/lore/dist/bin`, so it
 * needs `yarn build` first, and `git` on the PATH.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

describe("a Lore repository from plain git and the lore CLI", () => {
  let child: ChildProcess;
  let dataDir: string;
  let home: string;
  let url: string;
  let output = "";
  let token: string;
  let key: string;
  let slug: string;
  let registry: Registry;

  /**
   * The environment every process of the user's shell gets: a clean HOME,
   * the instance and the key, never the machine's own.
   */
  const env = () => ({
    PATH: process.env.PATH ?? "",
    HOME: home,
    // vitest's NODE_ENV=test would boot the CLI, and the helper git spawns,
    // on an in-memory file system.
    NODE_ENV: "development",
    LORE_URL: url,
    LORE_API_KEY: key,
    LORE_PROJECT: slug,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "ana",
    GIT_AUTHOR_EMAIL: "ana@example.com",
    GIT_COMMITTER_NAME: "ana",
    GIT_COMMITTER_EMAIL: "ana@example.com",
    CLAUDECODE: "",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  });

  const lore = (
    args: string[],
    cwd = home,
  ): Promise<{ code: number; out: string; err: string }> =>
    new Promise((done, reject) => {
      const cli = spawn("node", [BIN, ...args], {
        cwd,
        env: env(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      cli.stdout.on("data", (d) => (out += d));
      cli.stderr.on("data", (d) => (err += d));
      cli.on("error", reject);
      cli.on("close", (code) => done({ code: code ?? -1, out, err }));
    });

  const git = (args: string[], cwd = home) =>
    execFileSync("git", args, { cwd, env: env(), encoding: "utf8" }).trim();

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

  beforeAll(async () => {
    for (const built of [join(LORE_DIR, "dist"), BIN]) {
      if (!existsSync(built)) {
        throw new Error(`${built} is missing: run \`yarn build\` first`);
      }
    }
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), "lore-code-e2e-data-"));
    home = mkdtempSync(join(tmpdir(), "lore-code-e2e-home-"));
    child = spawn("node", ["dist"], {
      cwd: LORE_DIR,
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        SERVER_HOST: "127.0.0.1",
        DATABASE_URL: ":memory:",
        DATA_DIR: dataDir,
        APP_SECRET: "code-e2e-secret",
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
    const project = await call<{ id: number; slug: string }>("createProject", {
      body: {
        title: "Hello code",
        capabilities: [
          { key: "build", options: { repositories: true, quality: true } },
        ],
      },
    });
    slug = project.slug;
    key = (
      await call<{ token: string }>("createApiKey", {
        body: { name: "code e2e" },
      })
    ).token;

    // The machine's keychain, as far as git can tell: a helper that STORES.
    git(["config", "--global", "credential.helper", "store"]);
  }, 120_000);

  afterAll(() => {
    child?.kill();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("creates a repository, takes a push and gives the clone back, storing no token", async () => {
    const created = await lore(["code", "repo", "create", "web"]);
    expect(created.err).toBe("");
    expect(created.code).toBe(0);
    expect(created.out).toContain(`/${slug}/web.git`);

    const source = join(home, "source");
    git(["init", "--quiet", "-b", "main", source]);
    writeFileSync(join(source, "README.md"), "hello\n");
    git(["add", "README.md"], source);
    git(["commit", "--quiet", "-m", "first"], source);
    const head = git(["rev-parse", "HEAD"], source);

    const remote = await lore(
      ["code", "remote", "--repo", "web", "--add"],
      source,
    );
    expect(remote.code).toBe(0);
    git(["push", "--quiet", "lore", "main"], source);

    const cloned = await lore(["clone", `${slug}/web`, "cloned"]);
    expect(cloned.code).toBe(0);
    expect(git(["rev-parse", "HEAD"], join(home, "cloned"))).toBe(head);

    // The helper line is the running binary, behind the empty entry.
    const helpers = execFileSync(
      "git",
      ["config", "--global", "--get-all", `credential.${url}.helper`],
      { cwd: home, env: env(), encoding: "utf8" },
    ).split("\n");
    expect(helpers[0]).toBe("");
    expect(helpers[1]).toMatch(/git-credential$/);
    // And the storing helper was never asked to keep anything.
    const stored = join(home, ".git-credentials");
    expect(existsSync(stored) ? readFileSync(stored, "utf8") : "").toBe("");
  });

  it("imports a checkout into a new repository, branches and tags with it", async () => {
    const source = join(home, "existing");
    git(["init", "--quiet", "-b", "main", source]);
    for (const name of ["one", "two", "three"]) {
      writeFileSync(join(source, `${name}.txt`), `${name}\n`);
      git(["add", "-A"], source);
      git(["commit", "--quiet", "-m", name], source);
    }
    git(["tag", "v1.0.0"], source);
    git(["branch", "docs", "HEAD~1"], source);

    const imported = await lore(["code", "import", "imported"], source);
    expect(imported.code).toBe(0);
    expect(imported.out).toMatch(/Imported main as main/);

    const cloned = await lore(["clone", `${slug}/imported`, "imported"]);
    expect(cloned.code).toBe(0);
    const clone = join(home, "imported");
    expect(git(["rev-parse", "HEAD"], clone)).toBe(
      git(["rev-parse", "HEAD"], source),
    );
    expect(git(["tag", "--list"], clone)).toBe("v1.0.0");
    expect(git(["ls-remote", "--heads", "origin", "docs"], clone)).toMatch(
      /refs\/heads\/docs/,
    );
  });

  it("refuses a push past the default branch's deletion", async () => {
    const source = join(home, "source");
    let refused = "";
    try {
      execFileSync("git", ["push", "lore", ":main"], {
        cwd: source,
        env: env(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      refused = String((error as { stderr?: string }).stderr ?? "");
    }
    expect(refused).toMatch(/default branch main cannot be deleted/);
  });
});
