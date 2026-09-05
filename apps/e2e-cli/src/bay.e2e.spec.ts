/**
 * The real Bay connector against the real Lore endpoint (epic #20, #1628).
 *
 * Everything before this is tested against a stub on one side or the other:
 * the connector's integration test drives a fake Lore, the Lore specs drive a
 * fake connector, and both can be green while the wire disagrees. This is the
 * one test where the Go binary talks to `/ws/estates` on a Lore booted from
 * `apps/lore/dist`, and the wire-format fixtures both suites pin are what
 * keeps the two from drifting between runs of it.
 *
 * ⚠️ It builds `bay` natively with `go build` and FAILS when `go` is missing.
 * No silent skip: a skipped Go test is exactly how `yarn w bay test` already
 * reports green while running none of the linux-only files. On a warm build
 * cache the build is under a second; the measured wall clock is printed.
 *
 * Requires `yarn build` first, like `lore.e2e.spec.ts`: Lore runs from
 * `apps/lore/dist`, the way `yarn start` runs it, on an in-memory database.
 * Bay serves from a temp root on a loopback address with its control socket
 * under that root, and dials the Lore sink over cleartext http, which the
 * connector allows for a loopback host only.
 *
 * Lore is driven over its HTTP API by action NAME: the token route answers
 * with the API registry the SPA itself uses, so no path is guessed here and a
 * moved route fails as "no such action" rather than as a 404 to interpret.
 *
 * Apps are plain child processes off Linux, so `restart` is real on macOS
 * too. The host gauge reports nothing off Linux by design, so the gauge on
 * the estate row is asserted on Linux only; CI runs there.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidatePorts, e2ePort } from "../../../playwright.port.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BAY_DIR = join(ROOT, "apps", "bay");
const LORE_DIR = join(ROOT, "apps", "lore");
const PASSWORD = "GoodPassw0rd!";

// ---------------------------------------------------------------------------
// processes
// ---------------------------------------------------------------------------

interface Ran {
  code: number;
  out: string;
}

const run = (command: string, args: string[], cwd: string): Promise<Ran> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? -1, out }));
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const until = async <T>(
  what: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await sleep(150);
  }
  throw new Error(
    `timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`,
  );
};

const portIsFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });

// `e2ePort` memoises its answer into E2E_PORT for a config and its setup to
// agree, so the second server takes its own slot's candidates directly.
const freeSlotPort = async (app: "bay-proxy"): Promise<number> => {
  for (const port of candidatePorts(ROOT, app)) {
    if (await portIsFree(port)) return port;
  }
  throw new Error("no free port in the e2e band");
};

// ---------------------------------------------------------------------------
// the Lore side, over its HTTP API
// ---------------------------------------------------------------------------

interface Registry {
  prefix?: string;
  actions: Record<string, { path: string; method?: string }>;
}

interface Session {
  email: string;
  token: string;
  id: string;
  api: Registry;
}

interface Lore {
  url: string;
  dataDir: string;
  child: ChildProcess;
  log: () => string;
}

interface Answer<T> {
  status: number;
  data: T;
  text: string;
}

const bootLore = async (port: number): Promise<Lore> => {
  const dist = join(LORE_DIR, "dist");
  if (!existsSync(dist)) {
    throw new Error(`apps/lore/dist is missing: run \`yarn build\` first`);
  }
  const dataDir = mkdtempSync(join(tmpdir(), "lore-bay-e2e-"));
  const child = spawn("node", ["dist"], {
    cwd: LORE_DIR,
    env: {
      ...process.env,
      SERVER_PORT: String(port),
      // Loopback by address, not by name: on macOS `localhost` resolves to
      // ::1 first, and the connector dials the sink by the address below.
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      DATA_DIR: dataDir,
      APP_SECRET: "bay-e2e-secret",
      // Mail stays off, so the realm asks for no verification code and the
      // registration intent completes on its own; nothing reads a mailbox.
      REGISTRATION_IP_MAX_ATTEMPTS: "1000",
      LOG_LEVEL: "warn",
      LOG_FORMAT: "json",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  const url = `http://127.0.0.1:${port}`;
  await until(
    "Lore to listen",
    async () => {
      if (child.exitCode !== null) {
        throw new Error(
          `Lore exited ${child.exitCode}:\n${output.slice(-3000)}`,
        );
      }
      const res = await fetch(`${url}/version`, {
        signal: AbortSignal.timeout(1_000),
      }).catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : "fetch failed"}\n${output.slice(-1500)}`,
        );
      });
      return res.ok ? true : undefined;
    },
    60_000,
  );
  return { url, dataDir, child, log: () => output.slice(-3000) };
};

const request = async <T = unknown>(
  lore: Lore,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; form?: FormData } = {},
): Promise<Answer<T>> => {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${lore.url}${path}`, { method, headers, body });
  const text = await res.text();
  let data: T = undefined as T;
  try {
    data = JSON.parse(text) as T;
  } catch {}
  return { status: res.status, data, text };
};

/**
 * One action by name, resolved through the registry the sign-in returned.
 * `:param` segments are filled from `params`; the rest is the body or form.
 */
const call = async <T = unknown>(
  lore: Lore,
  session: Session,
  action: string,
  options: {
    params?: Record<string, string | number>;
    body?: unknown;
    form?: FormData;
  } = {},
): Promise<Answer<T>> => {
  const entry = session.api.actions[action];
  if (!entry) {
    throw new Error(`no API action named ${action} in the registry`);
  }
  let path = entry.path;
  for (const [key, value] of Object.entries(options.params ?? {})) {
    path = path.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return request<T>(
    lore,
    entry.method ?? "GET",
    `${session.api.prefix ?? "/api"}${path}`,
    {
      token: session.token,
      body: options.body,
      form: options.form,
    },
  );
};

const ok = async <T>(promise: Promise<Answer<T>>): Promise<T> => {
  const res = await promise;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${res.status}: ${res.text}`);
  }
  return res.data;
};

/**
 * Register through the intent flow and sign in through the token route, the
 * calls the SPA makes, with no browser in the way.
 */
const signUp = async (lore: Lore, label: string): Promise<Session> => {
  const email = `${label}-${Date.now()}@example.com`;
  const intent = await ok<{
    intentId: string;
    expectEmailVerification: boolean;
  }>(
    request(lore, "POST", "/api/users/register", {
      body: {
        email,
        password: PASSWORD,
        username: `${label}${Date.now() % 100000}`,
      },
    }),
  );
  if (intent.expectEmailVerification) {
    throw new Error(
      "the realm asked for a mailed code, which this suite runs without",
    );
  }
  const user = await ok<{ id: string }>(
    request(lore, "POST", "/api/users/register/complete", {
      body: { intentId: intent.intentId },
    }),
  );
  const tokens = await ok<{ access_token: string; api: Registry }>(
    request(lore, "POST", "/_auth/token?provider=credentials", {
      body: { username: email, password: PASSWORD },
    }),
  );
  return { email, token: tokens.access_token, id: user.id, api: tokens.api };
};

// ---------------------------------------------------------------------------
// the Bay side
// ---------------------------------------------------------------------------

interface Bay {
  bin: string;
  root: string;
  socket: string;
  port: number;
  child?: ChildProcess;
  log: string;
}

const startBay = async (bay: Bay): Promise<void> => {
  bay.log = "";
  const child = spawn(
    bay.bin,
    [
      "serve",
      "--root",
      bay.root,
      "--addr",
      `127.0.0.1:${bay.port}`,
      "--control-socket",
      bay.socket,
      "--base-domain",
      "bay.test",
      "--backup-interval",
      "0",
    ],
    { cwd: bay.root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (d) => (bay.log += d));
  child.stderr?.on("data", (d) => (bay.log += d));
  bay.child = child;
  await until(
    "bay serve to listen",
    async () => {
      if (child.exitCode !== null) {
        throw new Error(`bay serve exited ${child.exitCode}:\n${bay.log}`);
      }
      const bound = !(await portIsFree(bay.port));
      return bound && existsSync(bay.socket) ? true : undefined;
    },
    30_000,
  );
};

const stopBay = async (bay: Bay): Promise<void> => {
  const child = bay.child;
  bay.child = undefined;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(20_000).then(() => child.kill("SIGKILL"))]);
  // The next start binds the same port: wait for this one to have let go.
  await until("the bay port to be released", async () =>
    (await portIsFree(bay.port)) ? true : undefined,
  );
};

const bayCli = (bay: Bay, args: string[]): Promise<Ran> =>
  run(bay.bin, [...args, "--control-socket", bay.socket], bay.root);

const connectorCli = (bay: Bay, args: string[]): Promise<Ran> =>
  run(
    bay.bin,
    ["connector", ...args, "--root", bay.root, "--control-socket", bay.socket],
    bay.root,
  );

/**
 * The smallest app both sides accept: Lore's manifest schema wants `version`
 * and a `runtime` it knows, Bay's wants a project name, a runtime it can run
 * and an entry, which Bay launches as `node <entry>` from the release root.
 * The process answers /health on the port Bay hands it.
 */
const packApp = async (
  dir: string,
  marker: string,
): Promise<{ path: string; bytes: Buffer }> => {
  const src = join(dir, `app-${marker}`);
  await mkdir(join(src, "dist"), { recursive: true });
  await writeFile(
    join(src, "dist", "manifest.json"),
    JSON.stringify({
      version: 1,
      project: "demo",
      runtime: "node",
      runtimeVersion: "24",
      entry: "dist",
    }),
  );
  await writeFile(
    join(src, "dist", "index.js"),
    `const http = require("node:http");
const marker = ${JSON.stringify(marker)};
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok", ready: true, marker }));
}).listen(Number(process.env.SERVER_PORT || 0), "127.0.0.1");
`,
  );
  const path = join(dir, `app-${marker}.tar.gz`);
  const tar = await run("tar", ["-czf", path, "-C", src, "dist"], dir);
  if (tar.code !== 0) throw new Error(`tar failed: ${tar.out}`);
  return { path, bytes: readFileSync(path) };
};

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const artifactForm = (
  bytes: Buffer,
  force = false,
  tag = "1.0.0",
): FormData => {
  const form = new FormData();
  form.append("app", "demo");
  form.append("tag", tag);
  if (force) form.append("force", "true");
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/gzip" }),
    "demo.tar.gz",
  );
  return form;
};

// ---------------------------------------------------------------------------
// the suite
// ---------------------------------------------------------------------------

interface EstateRow {
  id: string;
  slug: string;
  online: boolean;
  deployAllowed: boolean;
  connectedAt?: string;
  lastSeenAt?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  statsAt?: string;
  secretPrefix?: string;
}

interface CommandRow {
  id: string;
  kind: string;
  status: string;
  step?: string;
  reason?: string;
  runningAt?: string;
}

interface ArtifactRow {
  id: string;
  sha256: string;
  tag: string;
}

describe("Bay connector against a real Lore", () => {
  const work = mkdtempSync(join(tmpdir(), "bay-e2e-"));
  const bay: Bay = {
    bin: join(work, "bay"),
    root: join(work, "root"),
    socket: join(work, "root", "control.sock"),
    port: 0,
    log: "",
  };
  let lore: Lore;
  let owner: Session;
  let estate: EstateRow;
  let secret: string;
  let projectId: number;

  const readEstate = (): Promise<EstateRow> =>
    ok<EstateRow>(
      call(lore, owner, "getEstate", { params: { estateId: estate.id } }),
    );

  const commands = async (): Promise<CommandRow[]> =>
    (
      await ok<{ items: CommandRow[] }>(
        call(lore, owner, "listEstateCommands", {
          params: { estateId: estate.id },
        }),
      )
    ).items;

  const enqueue = (body: unknown) =>
    call<CommandRow>(lore, owner, "enqueueEstateCommand", {
      params: { estateId: estate.id },
      body,
    });

  const commandSettles = (id: string) =>
    until(
      `command ${id} to settle`,
      async () => {
        const row = (await commands()).find((c) => c.id === id);
        return row && (row.status === "done" || row.status === "failed")
          ? row
          : undefined;
      },
      90_000,
    );

  /**
   * `bay connector show` once the dial has been refused. A fresh serve brings
   * its apps back up before it dials, so the wait is generous, and the last
   * output is in the failure so a repeat is diagnosable.
   */
  const untilRefused = async (what: string): Promise<string> => {
    let lastShow = "";
    try {
      return await until(
        `${what} to be refused`,
        async () => {
          const show = await connectorCli(bay, ["show"]);
          lastShow = show.out;
          return show.out.includes("401") ? show.out : undefined;
        },
        90_000,
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : "timeout"}\nlast show:\n${lastShow}\nbay log:\n${bay.log.slice(-2000)}`,
      );
    }
  };

  const currentArtifact = async (tag: string): Promise<ArtifactRow> => {
    const listing = await ok<{
      groups: Array<{ tag: string; variants: ArtifactRow[] }>;
    }>(call(lore, owner, "listArtifacts", { params: { projectId } }));
    const group = listing.groups.find((g) => g.tag === tag);
    if (!group?.variants[0]) throw new Error(`no artifact under tag ${tag}`);
    return group.variants[0];
  };

  beforeAll(async () => {
    // The Go build, timed: the number the owner asked for.
    const started = Date.now();
    let built: Ran;
    try {
      built = await run("go", ["build", "-o", bay.bin, "./cmd/bay"], BAY_DIR);
    } catch (error) {
      throw new Error(
        "bay.e2e.spec.ts needs a Go toolchain to build apps/bay, and none was found on PATH. " +
          "Install Go (apps/bay/go.mod names the version) rather than skipping: a skipped Go test " +
          `is how a green run lies. (${error instanceof Error ? error.message : "spawn failed"})`,
      );
    }
    if (built.code !== 0) {
      throw new Error(`go build failed:\n${built.out}`);
    }
    console.info(`[bay e2e] go build (warm cache): ${Date.now() - started} ms`);

    const lorePort = e2ePort("bay");
    bay.port = await freeSlotPort("bay-proxy");
    lore = await bootLore(lorePort);
    owner = await signUp(lore, "owner");
    await mkdir(bay.root, { recursive: true });
    await startBay(bay);
  }, 180_000);

  afterAll(async () => {
    await stopBay(bay).catch(() => undefined);
    lore?.child.kill("SIGKILL");
    try {
      rmSync(work, { recursive: true, force: true });
      if (lore) rmSync(lore.dataDir, { recursive: true, force: true });
    } catch {}
  });

  it("enrols a real bay serve with a secret from the reveal-once flow, and the connection opens", async () => {
    const minted = await ok<EstateRow & { secret: string }>(
      call(lore, owner, "createEstate", { body: { slug: "ovh-1" } }),
    );
    estate = minted;
    secret = minted.secret;
    expect(secret.startsWith("est_")).toBe(true);
    // Reveal once: no read path returns it again.
    const again = await readEstate();
    expect(again.secretPrefix).toBeDefined();
    expect(JSON.stringify(again)).not.toContain(secret);

    const set = await connectorCli(bay, ["set", lore.url, secret]);
    expect(set.code, set.out).toBe(0);
    expect(set.out).not.toContain(secret.slice(4));

    const connected = await until("the estate to come online", async () => {
      const row = await readEstate();
      return row.online ? row : undefined;
    });
    expect(connected.connectedAt).toBeDefined();
    expect(connected.lastSeenAt).toBeDefined();

    // The first stats push lands right after the welcome. The gauge is a
    // Linux reading; off Linux the connector reports nothing by design.
    if (process.platform === "linux") {
      const gauged = await until("the gauge to be stamped", async () => {
        const row = await readEstate();
        return row.statsAt ? row : undefined;
      });
      expect(gauged.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(gauged.memoryPercent).toBeGreaterThan(0);
    }

    const show = await connectorCli(bay, ["show"]);
    expect(show.code, show.out).toBe(0);
    expect(show.out).toContain("ovh-1");
    expect(show.out).toContain("up since");
    expect(show.out).not.toContain("est_");
  });

  it("picks up an enqueued restart, acks running then done, and Lore shows done", async () => {
    const app = await packApp(work, "first");
    const deployed = await bayCli(bay, [
      "deploy",
      app.path,
      "--name",
      "demo",
      "--env",
      "production",
    ]);
    expect(deployed.code, deployed.out).toBe(0);

    const queued = await ok(
      enqueue({ kind: "restart", app: "demo", environment: "production" }),
    );
    const settled = await commandSettles(queued.id);
    expect(settled.status, settled.reason).toBe("done");
    // `running` was acked on pickup: the row carries the stamp.
    expect(settled.runningAt).toBeDefined();

    const listed = await bayCli(bay, ["list"]);
    expect(listed.out).toContain("demo");
  });

  it("refuses a deploy at enqueue while deployAllowed is off, then runs one to done with an empty secret set", async () => {
    const project = await ok<{ id: number }>(
      call(lore, owner, "createProject", { body: { title: "Bay E2E" } }),
    );
    projectId = project.id;

    const app = await packApp(work, "second");
    const pushed = await ok<{ artifact: ArtifactRow }>(
      call(lore, owner, "pushArtifact", {
        params: { projectId },
        form: artifactForm(app.bytes),
      }),
    );
    expect(pushed.artifact.sha256).toBe(sha256(app.bytes));

    await ok(
      call(lore, owner, "attachEstate", {
        params: { projectId },
        body: { estateId: estate.id },
      }),
    );

    // Off by default: refused server-side, before anything reaches the machine.
    const refused = await enqueue({
      kind: "deploy",
      artifactId: pushed.artifact.id,
      environment: "production",
    });
    expect(refused.status, refused.text).toBe(403);

    await ok(
      call(lore, owner, "updateEstate", {
        params: { estateId: estate.id },
        body: { deployAllowed: true },
      }),
    );
    const queued = await ok(
      enqueue({
        kind: "deploy",
        artifactId: pushed.artifact.id,
        environment: "production",
      }),
    );
    const settled = await commandSettles(queued.id);
    expect(settled.status, settled.reason).toBe("done");
    expect(
      existsSync(
        join(bay.root, "artifacts", `${pushed.artifact.sha256}.tar.gz`),
      ),
    ).toBe(true);
  });

  it("fails a deploy whose digest no longer matches, with no partial state", async () => {
    // A tag Bay has never pulled: an artifact it already holds under its
    // digest would be deployed from the cache, which is the point of the
    // cache and not the case under test.
    const fresh = await packApp(work, "fourth");
    await ok(
      call(lore, owner, "pushArtifact", {
        params: { projectId },
        form: artifactForm(fresh.bytes, false, "2.0.0"),
      }),
    );
    const current = await currentArtifact("2.0.0");
    expect(
      existsSync(join(bay.root, "artifacts", `${current.sha256}.tar.gz`)),
    ).toBe(false);

    // Queue while the machine is away, so the command waits for the next hello.
    await stopBay(bay);
    const queued = await ok(
      enqueue({
        kind: "deploy",
        artifactId: current.id,
        environment: "production",
      }),
    );
    expect(queued.status).toBe("pending");

    // The tag moves onto other bytes before the machine comes back: the
    // command's snapshot names a digest the row no longer holds, and the
    // sink refuses to serve it.
    const moved = await packApp(work, "fifth");
    await ok(
      call(lore, owner, "pushArtifact", {
        params: { projectId },
        form: artifactForm(moved.bytes, true, "2.0.0"),
      }),
    );
    expect((await currentArtifact("2.0.0")).sha256).not.toBe(current.sha256);

    await startBay(bay);
    const settled = await commandSettles(queued.id);
    expect(settled.status).toBe("failed");
    expect(settled.reason ?? "").toMatch(/404|refus/i);
    expect(
      existsSync(join(bay.root, "artifacts", `${current.sha256}.tar.gz`)),
    ).toBe(false);
    // The app that was serving still is.
    const listed = await bayCli(bay, ["list"]);
    expect(listed.out).toContain("demo");
  });

  it("lets a lent-to member see the loan but never the secret, and never the owner's other estates", async () => {
    const other = await ok<EstateRow>(
      call(lore, owner, "createEstate", { body: { slug: "hetzner" } }),
    );
    const member = await signUp(lore, "member");
    await ok(
      call(lore, owner, "createInvitation", {
        body: {
          email: member.email,
          resourceType: "project",
          resourceId: String(projectId),
        },
      }),
    );
    const inbox = await ok<Array<{ id: string }>>(
      call(lore, member, "listMyInvitations"),
    );
    expect(inbox.length).toBe(1);
    await ok(
      call(lore, member, "acceptInvitation", { params: { id: inbox[0].id } }),
    );

    const lent = await ok<{ items: Array<Record<string, unknown>> }>(
      call(lore, member, "listProjectEstates", { params: { projectId } }),
    );
    expect(lent.items.map((i) => i.slug)).toEqual(["ovh-1"]);
    const text = JSON.stringify(lent);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("hetzner");

    expect(
      (
        await call(lore, member, "getEstate", {
          params: { estateId: estate.id },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(lore, member, "getEstate", {
          params: { estateId: other.id },
        })
      ).status,
    ).toBe(404);
    const mine = await ok<{ items: unknown[] }>(
      call(lore, member, "listMyEstates"),
    );
    expect(mine.items).toEqual([]);
  });

  it("rotating and then deleting the estate make the next dial a 401 that hands over nothing", async () => {
    await ok(
      call(lore, owner, "rotateEstate", { params: { estateId: estate.id } }),
    );

    // The live socket is not cut by a rotation; the next dial is what is
    // refused, so the machine is restarted to force one.
    await stopBay(bay);
    await startBay(bay);
    const refused = await untilRefused("the rotated secret");
    expect(refused).toContain("down");
    expect(refused).not.toContain("est_");

    const gone = await call(lore, owner, "deleteEstate", {
      params: { estateId: estate.id },
    });
    expect(gone.status, gone.text).toBe(200);
    await stopBay(bay);
    await startBay(bay);
    const stillRefused = await untilRefused("the deleted estate");
    expect(stillRefused).toContain("down");
  });
});
