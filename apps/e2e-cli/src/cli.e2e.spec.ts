/**
 * End-to-end tests for the Alepha CLI.
 *
 * These run against **the artifact npm would ship**, not the workspace.
 *
 * The distinction is the whole point. Inside the monorepo,
 * `node_modules/.bin/alepha` resolves to `packages/alepha/src/bin/index.ts` —
 * raw TypeScript, type-stripped by node. What a user installs is
 * `dist/bin/index.js`, because `publishConfig` rewrites `main`, `types`, `bin`
 * and the whole `exports` map at publish time. Testing the first proves nothing
 * about the second.
 *
 * So each run packs the workspace with `yarn pack` — which applies
 * `publishConfig`, where `npm pack` does not — and installs the tarball into a
 * throwaway project. No registry, no Docker: the tarball is the same bytes the
 * registry would serve.
 *
 * The project lives in `.e2e-tmp/`, deliberately **outside** the `apps/**` and
 * `packages/**` workspace globs. It used to be `apps/tmp`, which yarn adopted as
 * a workspace member — with two consequences:
 *
 *   1. every run rewrote the root `yarn.lock` to register the scratch project;
 *   2. its `alepha` dependency resolved to the workspace, so the suite could
 *      never have caught a packaging bug.
 *
 * Moving it out fixes both. Note that moving it out is not enough on its own:
 * a plain `npm install` there pulls `alepha` from registry.npmjs.org — the
 * *previously published* version — and the suite would go green no matter what
 * the working tree does. Hence the tarball.
 *
 * Requires `yarn build` first (the tarball carries `dist/`). `yarn verify`
 * already builds before it reaches here; `beforeAll` fails loudly otherwise.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(thisFile), "../../.."); // apps/e2e-cli/src -> monorepo root
const WORK_DIR = join(ROOT, ".e2e-tmp");
const TARBALL_DIR = join(WORK_DIR, "tarballs");
const PROJECT_DIR = join(WORK_DIR, "proj");
const isWindows = process.platform === "win32";

/**
 * The CLI as a consumer invokes it: the binary the tarball installed.
 *
 * Never `yarn alepha` — that would walk back up to the workspace copy and
 * quietly test the source again.
 */
const CLI = join(
  PROJECT_DIR,
  "node_modules",
  ".bin",
  isWindows ? "alepha.cmd" : "alepha",
);

/**
 * Run a command and wait for completion.
 */
async function run(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        // An agent session implies `--verbose` (see CliProvider), which buries
        // the assertions under trace logs. These tests are the consumer's view.
        CLAUDECODE: "",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(
      () => {
        proc.kill();
        reject(new Error(`Command timed out: ${command}`));
      },
      isWindows ? 180_000 : 120_000,
    );

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Start a long-running process and return a handle.
 */
function startProcess(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): {
  process: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  kill: () => Promise<void>;
  waitForOutput: (pattern: RegExp, timeout?: number) => Promise<void>;
} {
  let stdout = "";
  let stderr = "";

  const proc = spawn(command, [], {
    cwd,
    shell: true,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      CLAUDECODE: "",
      YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      ...env,
    },
  });

  proc.stdout?.on("data", (data) => {
    stdout += data.toString();
  });

  proc.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  return {
    process: proc,
    stdout: () => stdout,
    stderr: () => stderr,
    kill: async () => {
      if (isWindows) {
        spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else if (proc.pid) {
        try {
          process.kill(-proc.pid, "SIGTERM");
        } catch {
          proc.kill("SIGTERM");
        }
      }
      // Wait for cleanup (Windows needs more time to release file handles)
      await new Promise((r) => setTimeout(r, isWindows ? 3000 : 500));
    },
    waitForOutput: (pattern: RegExp, timeout = 30_000) => {
      return new Promise((resolvePromise, reject) => {
        const startTime = Date.now();
        const check = () => {
          if (pattern.test(stdout + stderr)) {
            resolvePromise();
            return;
          }
          if (Date.now() - startTime > timeout) {
            reject(
              new Error(
                `Timeout waiting for pattern: ${pattern}\nStdout: ${stdout}\nStderr: ${stderr}`,
              ),
            );
            return;
          }
          setTimeout(check, 100);
        };
        check();
      });
    },
  };
}

/**
 * Fetch with retry for server startup.
 */
async function fetchWithRetry(
  url: string,
  maxRetries = 10,
  delay = 500,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastError = err as Error;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

describe("Alepha CLI E2E", () => {
  beforeAll(async () => {
    if (existsSync(WORK_DIR)) {
      await rm(WORK_DIR, { recursive: true, force: true });
    }

    // `yarn pack` ships `dist/`. Without a build the tarball is an empty shell
    // and every assertion below fails for a reason that has nothing to do with
    // the CLI, so say the real thing here.
    if (!existsSync(join(ROOT, "packages/alepha/dist/bin/index.js"))) {
      throw new Error(
        "packages/alepha/dist is missing — run `yarn build` before `yarn e2e-cli`.\n" +
          "These tests install a packed tarball, and the tarball carries dist/.",
      );
    }

    await mkdir(TARBALL_DIR, { recursive: true });
    await mkdir(PROJECT_DIR, { recursive: true });

    // `yarn pack`, not `npm pack`: the `publishConfig` overrides that repoint
    // `main`/`types`/`bin`/`exports` at `dist/` are a yarn extension, and npm
    // ignores them. An npm-packed tarball would still point at `src/*.ts` and
    // would not be what the registry serves.
    for (const [workspace, file] of [
      ["alepha", "alepha.tgz"],
      // `alepha init` adds it as a devDependency, so it has to resolve locally
      // too — otherwise init's install reaches for the published copy.
      ["@alepha/devtools", "devtools.tgz"],
    ]) {
      const out = join(TARBALL_DIR, file);
      const packed = await run(
        `yarn workspace ${workspace} pack -o "${out}"`,
        ROOT,
      );
      if (packed.exitCode !== 0 || !existsSync(out)) {
        throw new Error(
          `Failed to pack ${workspace}:\n${packed.stdout}\n${packed.stderr}`,
        );
      }
    }

    await writeFile(
      join(PROJECT_DIR, "package.json"),
      `${JSON.stringify({ name: "e2e-consumer", version: "1.0.0", private: true }, null, 2)}\n`,
    );

    const installed = await run(
      `npm install "${join(TARBALL_DIR, "alepha.tgz")}" "${join(TARBALL_DIR, "devtools.tgz")}"`,
      PROJECT_DIR,
    );
    if (installed.exitCode !== 0) {
      throw new Error(
        `Failed to install the packed tarballs:\n${installed.stdout}\n${installed.stderr}`,
      );
    }
  }, 300_000);

  afterAll(async () => {
    // Skip cleanup on Windows CI - runners are ephemeral and EBUSY errors are common
    if (isWindows && process.env.CI) {
      return;
    }
    if (existsSync(WORK_DIR)) {
      await rm(WORK_DIR, { recursive: true, force: true });
    }
  });

  describe("the installed package", () => {
    it("exposes a runnable bin from dist, not src", async () => {
      const pkg = JSON.parse(
        await readFile(
          join(PROJECT_DIR, "node_modules/alepha/package.json"),
          "utf-8",
        ),
      );

      // If `publishConfig` had not been applied these would still say `src/`,
      // which is the single failure mode that breaks every consumer at once.
      expect(pkg.bin).toContain("dist/");
      expect(pkg.main).toContain("dist/");
      expect(pkg.types).toContain("dist/");

      const result = await run(`"${CLI}" --version`, PROJECT_DIR);
      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).toContain("Alepha v");
    });

    it("resolves every subpath its exports map declares", async () => {
      // Reaches for each condition's target on disk as well as importing the
      // one node picks: a broken `browser`, `workerd` or `bun` entry is
      // invisible to a plain import but breaks the bundler that asks for it.
      const probe = `
        const { createRequire } = require("node:module");
        const { existsSync } = require("node:fs");
        const { dirname, join } = require("node:path");
        const req = createRequire(process.cwd() + "/probe.js");
        const pkgPath = req.resolve("alepha/package.json");
        const pkg = req(pkgPath);
        const dir = dirname(pkgPath);
        const missing = [];
        const failed = [];
        (async () => {
          for (const sub of Object.keys(pkg.exports)) {
            if (sub === "./package.json" || sub === "./tsconfig.base") continue;
            const entry = pkg.exports[sub];
            if (entry && typeof entry === "object") {
              for (const [cond, target] of Object.entries(entry)) {
                if (typeof target === "string" && !existsSync(join(dir, target))) {
                  missing.push(sub + " [" + cond + "] -> " + target);
                }
              }
            }
            const spec = sub === "." ? "alepha" : "alepha/" + sub.slice(2);
            try { await import(spec); } catch (err) { failed.push(spec + " " + err.code); }
          }
          console.log(JSON.stringify({ missing, failed }));
        })();
      `;
      await writeFile(join(PROJECT_DIR, "probe.cjs"), probe);

      const result = await run("node probe.cjs", PROJECT_DIR);
      const report = JSON.parse(
        result.stdout.trim().split("\n").pop() as string,
      );

      expect(report.missing).toEqual([]);
      expect(report.failed).toEqual([]);
    });

    it("does not export the CLI entry point", async () => {
      // `alepha/bin` boots Alepha and runs a command as a side effect of being
      // loaded, so exporting it meant any tool walking the map launched the CLI.
      await writeFile(
        join(PROJECT_DIR, "bin-probe.cjs"),
        `import("alepha/bin").then(() => console.log("IMPORTED")).catch((e) => console.log(e.code));`,
      );

      const result = await run("node bin-probe.cjs", PROJECT_DIR);
      expect(result.stdout).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
    });
  });

  describe("init", () => {
    it("scaffolds a full project", async () => {
      const result = await run(`"${CLI}" init`, PROJECT_DIR);

      if (result.exitCode !== 0) {
        console.log("INIT FAILED:");
        console.log("stdout:", result.stdout.slice(-2000));
        console.log("stderr:", result.stderr);
      }

      expect(result.exitCode).toBe(0);
      // `--api` / `--react` were removed when init moved to a single project
      // shape; the scaffold now always contains both `src/api` and `src/web`.
      expect(existsSync(join(PROJECT_DIR, "src/main.server.ts"))).toBe(true);
      expect(existsSync(join(PROJECT_DIR, "src/api/index.ts"))).toBe(true);
      expect(existsSync(join(PROJECT_DIR, "src/web/index.ts"))).toBe(true);
      // Test scaffolding is now always-on (vitest ships embedded in alepha).
      expect(existsSync(join(PROJECT_DIR, "test/dummy.spec.ts"))).toBe(true);
    });

    it("writes the .env.example its .gitignore promises", async () => {
      // The generated `.gitignore` carries `!.env.example`, and `APP_SECRET` is
      // a hard stop in production — so the file has to exist, and has to name
      // that variable.
      const envExample = await readFile(
        join(PROJECT_DIR, ".env.example"),
        "utf-8",
      );
      expect(envExample).toContain("APP_SECRET");

      const gitignore = await readFile(
        join(PROJECT_DIR, ".gitignore"),
        "utf-8",
      );
      expect(gitignore).toContain("!.env.example");
    });

    it("keeps the locally packed alepha rather than the published one", async () => {
      // Guards the trap this suite was rebuilt around: init runs its own
      // `npm install`, and if that swapped in registry.npmjs.org's copy, every
      // test above would pass against the previous release instead of the
      // working tree.
      const lock = JSON.parse(
        await readFile(join(PROJECT_DIR, "package-lock.json"), "utf-8"),
      );
      expect(lock.packages["node_modules/alepha"].resolved).toContain(
        "alepha.tgz",
      );
    });
  });

  describe("help and usage", () => {
    it("prints help for the root, a command and a nested subcommand", async () => {
      const root = await run(`"${CLI}" --help`, PROJECT_DIR);
      expect(root.exitCode).toBe(0);
      expect(root.stdout).toContain("Commands:");

      const command = await run(`"${CLI}" build --help`, PROJECT_DIR);
      expect(command.exitCode).toBe(0);
      expect(command.stdout).toContain("Usage:");

      const nested = await run(`"${CLI}" db migrations --help`, PROJECT_DIR);
      expect(nested.exitCode).toBe(0);
      expect(nested.stdout).toContain("Usage:");
    });

    it("reports a bad flag as usage, not as a crash", async () => {
      const result = await run(`"${CLI}" build --nope`, PROJECT_DIR);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(output).toContain("Unknown flag: --nope");
      // A typo must not print a stack trace through CliProvider internals, nor
      // claim the app "failed to start".
      expect(output).not.toContain("failed to start");
      expect(output).not.toMatch(/^\s+at /m);
    });

    it("reports an unknown command as usage, not as a crash", async () => {
      const result = await run(`"${CLI}" nosuchcommand`, PROJECT_DIR);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(output).toContain("Unknown command");
      expect(output).not.toMatch(/^\s+at /m);
    });
  });

  describe("dev server", () => {
    it("serves the app", async () => {
      const devServer = startProcess(`"${CLI}" dev`, PROJECT_DIR, {
        SERVER_PORT: "15000",
      });

      try {
        await devServer.waitForOutput(
          /ready in|Server listening|localhost/i,
          60_000,
        );
        await new Promise((r) => setTimeout(r, 1000));

        const response = await fetchWithRetry(
          "http://localhost:15000",
          20,
          500,
        );
        expect(response.status).toBe(200);
      } finally {
        await devServer.kill();
      }
    });

    it("answers 500 while broken, and recovers", async () => {
      const mainServerPath = join(PROJECT_DIR, "src/main.server.ts");
      const originalContent = await readFile(mainServerPath, "utf-8");

      const devServer = startProcess(`"${CLI}" dev`, PROJECT_DIR, {
        SERVER_PORT: "15001",
      });

      try {
        await devServer.waitForOutput(
          /ready in|Server listening|localhost/i,
          60_000,
        );
        await new Promise((r) => setTimeout(r, 1000));

        const initialResponse = await fetchWithRetry("http://localhost:15001");
        expect(initialResponse.status).toBe(200);

        await writeFile(
          mainServerPath,
          `${originalContent}\n\nconst broken = {`,
          "utf-8",
        );
        await new Promise((r) => setTimeout(r, isWindows ? 6000 : 4000));

        // Specifically 500, not merely ">= 400". It used to fall through to
        // Vite and come back 404, which reads as "your route is wrong" when the
        // truth is "your app does not compile".
        const errorResponse = await fetch("http://localhost:15001/api/hello", {
          headers: { accept: "application/json" },
        });
        expect(errorResponse.status).toBe(500);

        // A browser still gets a 200 shell so Vite's error overlay can attach.
        const htmlResponse = await fetch("http://localhost:15001/", {
          headers: { accept: "text/html" },
        });
        expect(htmlResponse.status).toBe(200);

        await writeFile(mainServerPath, originalContent, "utf-8");
        await new Promise((r) => setTimeout(r, isWindows ? 8000 : 3000));

        const recoveryResponse = await fetchWithRetry(
          "http://localhost:15001",
          20,
          500,
        );
        expect(recoveryResponse.status).toBe(200);
      } finally {
        await writeFile(mainServerPath, originalContent, "utf-8");
        await devServer.kill();
      }
    });
  });

  describe("test, build and run", () => {
    it("runs the scaffolded test suite", async () => {
      const result = await run(`"${CLI}" test`, PROJECT_DIR);

      if (result.exitCode !== 0) {
        console.log("TEST OUTPUT:", result.stdout.slice(-1000));
        console.log("TEST STDERR:", result.stderr);
      }

      expect(result.exitCode).toBe(0);
    });

    it("forwards a positional arg as a filename filter", async () => {
      const otherSpec = join(PROJECT_DIR, "test/other.spec.ts");
      // A deliberately failing spec — its exit code is the filter probe.
      await writeFile(
        otherSpec,
        'import { expect, test } from "vitest";\n\ntest("fails on purpose", () => {\n  expect(true).toBe(false);\n});\n',
      );

      try {
        // Filter to the failing spec → it runs → non-zero exit.
        const onFailing = await run(`"${CLI}" test other`, PROJECT_DIR);
        expect(onFailing.exitCode).not.toBe(0);

        // Filter to the passing spec → the failing one is excluded → exit 0.
        // If positional args were ignored, the whole suite (including the
        // failing spec) would run and this would be non-zero.
        const onPassing = await run(`"${CLI}" test dummy`, PROJECT_DIR);
        expect(onPassing.exitCode).toBe(0);
      } finally {
        await rm(otherSpec, { force: true });
      }
    });

    it("builds, and the build actually boots", async () => {
      const result = await run(`"${CLI}" build`, PROJECT_DIR);

      if (result.exitCode !== 0) {
        console.log("BUILD OUTPUT:", result.stdout.slice(-2000));
        console.log("BUILD STDERR:", result.stderr);
      }

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(PROJECT_DIR, "dist/index.js"))).toBe(true);

      // A build that compiles but cannot serve a request is not a build. Needs
      // APP_SECRET: the app refuses to start in production without one, which
      // is exactly the behaviour `.env.example` documents.
      const server = startProcess("node dist/index.js", PROJECT_DIR, {
        SERVER_PORT: "15002",
        NODE_ENV: "production",
        APP_SECRET: "e2e-only-not-a-real-secret-0123456789abcdef",
      });

      try {
        const response = await fetchWithRetry(
          "http://localhost:15002/api/hello",
          30,
          500,
        );
        expect(response.status).toBe(200);
      } finally {
        await server.kill();
      }
    });
  });
});
