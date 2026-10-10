/**
 * `alepha compile --desktop`, end to end, against the packed tarballs of
 * `alepha` and `@alepha/desktop` (#E54, #Q2522).
 *
 * A native window cannot open on a CI runner, so the fixture injects a
 * headless shell at compile time (`compileDesktop({ headless })`): a window
 * that drives the app over HTTP the way the webview does, then closes. Every
 * other part is the real one, compiled into one executable by Bun: the
 * desktop shell, the instance lock, the log file, the supervisor Worker, the
 * server Worker with the app, its embedded public files, its SQLite
 * migration, and the admission guard. This is not native macOS coverage: the
 * window, the menu and the bundle are verified on a Mac (see the E54 release
 * folio).
 *
 * The executable is copied away from the project and run from `/`, with a
 * temporary HOME, so nothing it needs can come from the checkout.
 *
 * Requires `yarn build` first, like the CLI suite: the tarballs carry `dist/`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(thisFile), "../../..");
// A sibling of the CLI suite's directory: each suite wipes its own.
const WORK_DIR = join(ROOT, ".e2e-tmp", "desktop");
const TARBALL_DIR = join(WORK_DIR, "tarballs");
const PROJECT_DIR = join(WORK_DIR, "proj");
const RUN_DIR = join(WORK_DIR, "run");
const HOME_DIR = join(WORK_DIR, "home");
const FIXTURE = join(dirname(thisFile), "fixtures", "desktop");
const CLI = join(PROJECT_DIR, "node_modules", ".bin", "alepha");
const IDENTIFIER = "dev.alepha.desktop-fixture";

/**
 * Run a command to completion.
 */
const run = (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
  inherit = true,
  timeoutMs = 300_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: inherit
        ? {
            ...process.env,
            FORCE_COLOR: "0",
            NO_COLOR: "1",
            CLAUDECODE: "",
            ...env,
          }
        : env,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (data) => (stdout += data.toString()));
    proc.stderr?.on("data", (data) => (stderr += data.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timed out: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

/**
 * Launch the compiled app the way Finder would: from `/`, with nothing in its
 * environment but a HOME and what the fixture reads.
 */
const launch = (name: string, extra: Record<string, string> = {}) =>
  run(
    join(RUN_DIR, "fixture"),
    [],
    "/",
    {
      // Not the test runner's environment: only what a Finder launch has.
      HOME: HOME_DIR,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      DESKTOP_FIXTURE_RESULT: join(WORK_DIR, `${name}.json`),
      DESKTOP_FIXTURE_MARKER: join(WORK_DIR, `${name}.stopped`),
      ...extra,
    },
    false,
  );

const readResult = async (name: string) =>
  JSON.parse(await readFile(join(WORK_DIR, `${name}.json`), "utf-8"));

describe("alepha compile --desktop (headless fixture)", () => {
  beforeAll(async () => {
    await rm(WORK_DIR, { recursive: true, force: true });
    for (const dist of [
      "packages/alepha/dist/bin/index.js",
      "packages/@alepha/desktop/dist/shell/index.js",
    ]) {
      if (!existsSync(join(ROOT, dist))) {
        throw new Error(
          `${dist} is missing: run \`yarn build\` before \`yarn e2e-cli\`.`,
        );
      }
    }
    await mkdir(TARBALL_DIR, { recursive: true });
    await mkdir(HOME_DIR, { recursive: true });

    const tarballs: string[] = [];
    for (const workspace of ["alepha", "@alepha/desktop"]) {
      const tarball = join(TARBALL_DIR, `${workspace.replace("/", "-")}.tgz`);
      const packed = await run(
        "yarn",
        ["workspace", workspace, "pack", "-o", tarball],
        ROOT,
      );
      if (packed.exitCode !== 0) {
        throw new Error(
          `Failed to pack ${workspace}:\n${packed.stdout}\n${packed.stderr}`,
        );
      }
      tarballs.push(tarball);
    }

    await cp(FIXTURE, PROJECT_DIR, { recursive: true });
    await writeFile(
      join(PROJECT_DIR, "package.json"),
      `${JSON.stringify({ name: "desktop-fixture", version: "1.2.3", private: true, type: "module" }, null, 2)}\n`,
    );
    const installed = await run(
      "npm",
      [
        "install",
        "--no-fund",
        "--no-audit",
        ...tarballs,
        "react@^19.3.0",
        "react-dom@^19.3.0",
      ],
      PROJECT_DIR,
    );
    if (installed.exitCode !== 0) {
      throw new Error(
        `Failed to install:\n${installed.stdout}\n${installed.stderr}`,
      );
    }
  }, 600_000);

  afterAll(async () => {
    if (!process.env.KEEP_E2E) {
      await rm(WORK_DIR, { recursive: true, force: true });
    }
  });

  it("builds the bun slice and compiles the shell, supervisor and server Worker into one executable", async () => {
    const built = await run(CLI, ["build", "--runtime", "bun"], PROJECT_DIR, {
      NODE_ENV: "development",
    });
    if (built.exitCode !== 0)
      console.log(built.stdout.slice(-2000), built.stderr);
    expect(built.exitCode).toBe(0);

    // Not NODE_ENV=test, inherited from vitest: the CLI would swap in its
    // memory file system and find no build at all.
    const compiled = await run("node", ["compile-headless.mjs"], PROJECT_DIR, {
      NODE_ENV: "production",
    });
    if (compiled.exitCode !== 0)
      console.log(compiled.stdout.slice(-2000), compiled.stderr);
    expect(compiled.exitCode).toBe(0);
    expect(existsSync(join(PROJECT_DIR, "dist", "fixture"))).toBe(true);
    // dist was consumed only once the executable existed.
    expect(existsSync(join(PROJECT_DIR, "dist", "index.bun.js"))).toBe(false);
    expect(existsSync(join(PROJECT_DIR, "dist", "public"))).toBe(false);
    expect(
      existsSync(join(PROJECT_DIR, "node_modules", ".alepha", "desktop-stage")),
    ).toBe(false);

    // Away from the project: no node_modules, no sources, no public/.
    await cp(join(PROJECT_DIR, "dist"), RUN_DIR, { recursive: true });
  }, 600_000);

  it("serves the app only through the one-use bootstrap, with embedded assets, a typed action and SQLite", async () => {
    const launched = await launch("first");
    expect(launched.exitCode).toBe(0);

    const result = await readResult("first");
    expect(result.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(result.unauthorized).toEqual({
      "/": 403,
      "/no/such/page": 403,
      "/api/inc": 403,
      OPTIONS: 403,
    });
    expect(result.bootstrap).toBe(303);
    expect(result.replay).toBe(403);
    expect(result.page).toEqual({ status: 200, greeting: true });
    expect(result.asset.status).toBe(200);
    expect(result.asset.bytes).toBeGreaterThan(1000);
    expect(result.counts).toEqual([2, 3]);
    expect(result.hostileOrigin).toBe(403);
    expect(await readFile(join(WORK_DIR, "first.stopped"), "utf-8")).toBe(
      "stopped",
    );

    const data = join(HOME_DIR, "Library", "Application Support", IDENTIFIER);
    expect(existsSync(join(data, "app.db"))).toBe(true);
    const log = await readFile(
      join(HOME_DIR, "Library", "Logs", IDENTIFIER, "app.log"),
      "utf-8",
    );
    expect(log).toContain("Migration OK");
    expect(log).not.toContain("capability=");
    expect(log).not.toContain("__alepha_desktop");
  }, 120_000);

  it("keeps its data across a relaunch", async () => {
    expect((await launch("second")).exitCode).toBe(0);
    expect((await readResult("second")).counts).toEqual([5, 6]);
  }, 120_000);

  it("exits nonzero, without serving, when the app fails to start", async () => {
    const failed = await launch("failed", { DESKTOP_FIXTURE_FAIL: "1" });
    expect(failed.exitCode).toBe(1);
    expect(existsSync(join(WORK_DIR, "failed.json"))).toBe(false);
    const log = await readFile(
      join(HOME_DIR, "Library", "Logs", IDENTIFIER, "app.log"),
      "utf-8",
    );
    expect(log).toContain(
      "ALERT Desktop Fixture could not start: injected startup failure",
    );
  }, 120_000);
});
