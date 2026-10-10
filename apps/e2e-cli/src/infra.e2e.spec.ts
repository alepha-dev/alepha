/**
 * Consumer tests for explicit infrastructure, using published dist exports.
 * The fixture is outside workspace globs. A test-only npm launcher pins the
 * generated dependencies to this run's tarballs before every install.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AlephaError } from "alepha";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORK = join(ROOT, ".e2e-tmp", "infra");
const HOST = join(WORK, "consumer");
const SHIMS = join(WORK, "bin");
const isWindows = process.platform === "win32";
const suffix = isWindows ? ".cmd" : "";
const CLI = join(HOST, "node_modules", ".bin", `alepha${suffix}`);
const CREATE = join(HOST, "node_modules", ".bin", `create-alepha${suffix}`);
const tarballs = {
  alepha: join(WORK, "alepha.tgz"),
  "@alepha/ui": join(WORK, "ui.tgz"),
  "create-alepha": join(WORK, "create.tgz"),
};

const run = (
  command: string,
  args: string[],
  cwd: string,
  extra: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolveRun, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (
        /^(CLOUDFLARE_|CF_|WRANGLER_|LORE_|BAY_|PUBLIC_URL|DATABASE_URL|ALEPHA_SERVERLESS)/.test(
          key,
        )
      ) {
        delete env[key];
      }
    }
    const child = spawn(command, args, {
      cwd,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...env,
        PATH: `${SHIMS}${delimiter}${process.env.PATH}`,
        INFRA_TEST_PATH: process.env.PATH,
        INFRA_TEST_TARBALLS: JSON.stringify(tarballs),
        INFRA_TEST_ROOT: WORK,
        NODE_ENV: "development",
        CLAUDECODE: "",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        LOG_LEVEL: "error",
        LOG_FORMAT: "pretty",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
        ...extra,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new AlephaError(
          `Timed out: ${command} ${args.join(" ")}\n${stdout}\n${stderr}`,
        ),
      );
    }, 240_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });

const success = async (
  command: string,
  args: string[],
  cwd: string,
  extra: Record<string, string> = {},
) => {
  const result = await run(command, args, cwd, extra);
  expect(
    result.code,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
  return result;
};
const configAt = (root: string) =>
  readFile(join(root, "alepha.config.ts"), "utf8");
const fixture = async (name: string) => {
  const root = join(WORK, name);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name, private: true, type: "module" }),
  );
  return root;
};
const callsAt = async (
  root: string,
): Promise<Array<{ step: string; env: string; prebuilt: boolean }>> => {
  const file = join(root, "calls.ndjson");
  return existsSync(file)
    ? (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
};
const clearCalls = (root: string) =>
  rm(join(root, "calls.ndjson"), { force: true });

describe("packed Infra CLI", () => {
  beforeAll(async () => {
    for (const entry of [
      "packages/alepha/dist/bin/index.js",
      "packages/@alepha/ui/dist/core/index.js",
      "packages/create-alepha/dist/index.js",
    ]) {
      if (!existsSync(join(ROOT, entry))) {
        throw new AlephaError(
          `Missing built artifact ${entry}. Run yarn build before CLI e2e.`,
        );
      }
    }
    await rm(WORK, { recursive: true, force: true });
    await mkdir(HOST, { recursive: true });
    await mkdir(SHIMS, { recursive: true });
    // The scaffold rewrites package.json before invoking npm. Intercept only
    // that install boundary, pin both direct and transitive framework copies,
    // then delegate to the real npm. The installed binaries remain untouched.
    const launcher = join(SHIMS, "npm-launcher.cjs");
    await writeFile(
      launcher,
      `
const { readFileSync, writeFileSync, appendFileSync, existsSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const pkgPath = join(process.cwd(), "package.json");
if (args[0] === "install" && existsSync(pkgPath)) {
  if (!resolve(process.cwd()).startsWith(resolve(process.env.INFRA_TEST_ROOT))) process.exit(97);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const tarballs = JSON.parse(process.env.INFRA_TEST_TARBALLS);
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, path] of Object.entries(tarballs)) {
      if (pkg[group]?.[name]) pkg[group][name] = "file:" + path.replaceAll("\\\\", "/");
    }
  }
  if (pkg.dependencies?.alepha) pkg.overrides = { ...pkg.overrides, alepha: pkg.dependencies.alepha };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\\n");
  appendFileSync(join(process.cwd(), ".npm-installs.ndjson"), JSON.stringify(pkg.dependencies) + "\\n");
}
const result = spawnSync(${JSON.stringify(isWindows ? "npm.cmd" : "npm")}, args, { stdio: "inherit", shell: ${isWindows}, env: { ...process.env, PATH: process.env.INFRA_TEST_PATH } });
if (result.error) { console.error(result.error); process.exit(98); }
process.exit(result.status ?? 99);
`,
    );
    const npmShim = join(SHIMS, `npm${suffix}`);
    await writeFile(
      npmShim,
      isWindows
        ? `@echo off\r\n"${process.execPath}" "${launcher}" %*\r\n`
        : `#!/usr/bin/env node\nimport ${JSON.stringify(launcher)};\n`,
    );
    if (!isWindows) await chmod(npmShim, 0o755);
    for (const [name, tarball] of Object.entries(tarballs)) {
      await success(
        isWindows ? "yarn.cmd" : "yarn",
        ["workspace", name, "pack", "-o", tarball],
        ROOT,
      );
    }
    await writeFile(
      join(HOST, "package.json"),
      JSON.stringify({
        name: "infra-consumer",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          Object.entries(tarballs).map(([name, file]) => [
            name,
            `file:${file.replaceAll("\\", "/")}`,
          ]),
        ),
      }),
    );
    await success(npmShim, ["install", "--no-audit", "--no-fund"], HOST);
  }, 300_000);

  afterAll(async () => {
    if (!(isWindows && process.env.CI))
      await rm(WORK, { recursive: true, force: true });
  }, 120_000);

  it("publishes the renamed exports and a command-free library", async () => {
    const pkg = JSON.parse(
      await readFile(join(HOST, "node_modules/alepha/package.json"), "utf8"),
    );
    expect(pkg.exports["./cli/infra"].import).toContain("dist/");
    expect(pkg.exports["./cli/infra-lib"].workerd).toContain("dist/");
    expect(pkg.exports["./cli/platform"]).toBeUndefined();
    expect(pkg.exports["./cli/platform-lib"]).toBeUndefined();
    const create = JSON.parse(
      await readFile(
        join(HOST, "node_modules/create-alepha/package.json"),
        "utf8",
      ),
    );
    expect(create.bin).toContain("dist/");
    await writeFile(
      join(HOST, "library.mjs"),
      `
import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { AlephaInfraLibPlugin, InfraOrchestrator, infraOptions } from "alepha/cli/infra-lib";
const alepha = Alepha.create().with(AlephaInfraLibPlugin);
console.log(JSON.stringify({ commands: alepha.inject(CliProvider).commands.map(x => x.name), orchestrator: typeof InfraOrchestrator, atom: infraOptions.name }));
for (const path of ["alepha/cli/platform", "alepha/cli/platform-lib"]) {
  try { await import(path); process.exitCode = 1; } catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error; }
}
`,
    );
    const result = await success(process.execPath, ["library.mjs"], HOST);
    expect(JSON.parse(result.stdout.trim()).commands).toEqual([]);
    await writeFile(
      join(HOST, "worker.mjs"),
      `import * as lib from "alepha/cli/infra-lib"; console.log(JSON.stringify({ orchestrator: typeof lib.InfraOrchestrator, shell: "WranglerApi" in lib, factories: "cloudflare" in lib || "bay" in lib }));`,
    );
    const worker = await success(
      process.execPath,
      ["--conditions=workerd", "worker.mjs"],
      HOST,
    );
    expect(JSON.parse(worker.stdout.trim())).toEqual({
      orchestrator: "function",
      shell: false,
      factories: false,
    });
  });

  it("discovers help without config and rejects missing operations and removed roots", async () => {
    const root = await fixture("empty");
    for (const args of [
      ["--help"],
      ["infra"],
      ["infra", "--help"],
      ["deploy", "--help"],
      ["infra", "deploy", "--help"],
    ]) {
      await success(CLI, args, root);
    }
    const help = await success(CLI, ["--help"], root);
    expect(help.stdout.match(/^\s+alepha deploy\s/gm)).toHaveLength(1);
    expect(help.stdout.match(/^\s+alepha infra\s/gm)).toHaveLength(1);
    for (const args of [
      ["deploy"],
      ["infra", "plan"],
      ["infra", "build"],
      ["infra", "deploy"],
    ]) {
      const result = await run(CLI, args, root);
      expect(result.code).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        'import { cloudflare, infra } from "alepha/cli/infra"',
      );
    }
    for (const args of [
      ["platform"],
      ["p"],
      ["up"],
      ["infra", "up"],
      ["infra", "auth", "login"],
      ["infra", "provision"],
      ["infra", "migrate"],
    ]) {
      expect((await run(CLI, args, root)).code).not.toBe(0);
    }
    expect((await readdir(root)).sort()).toEqual(["package.json"]);
    await writeFile(
      join(root, "alepha.config.ts"),
      'import { AlephaError } from "alepha"; throw new AlephaError("CONFIG_MUST_NOT_LOAD");',
    );
    for (const args of [
      ["--help"],
      ["infra"],
      ["deploy", "--help"],
      ["infra", "--help"],
    ])
      await success(CLI, args, root);
  });

  it.each([
    { name: "default-app", preset: "default", provider: "cf", equals: false },
    { name: "saas-app", preset: "saas", provider: "cloudflare", equals: true },
  ])(
    "scaffolds and builds packed $preset infra without cloud credentials",
    async (options) => {
      const root = join(WORK, options.name);
      const flag = options.equals
        ? [`--infra=${options.provider}`]
        : ["--infra", options.provider];
      await success(
        CLI,
        [
          "init",
          options.name,
          "--preset",
          options.preset,
          "--pm",
          "npm",
          ...flag,
        ],
        WORK,
      );
      const config = await configAt(root);
      expect(config).toMatch(/^\s+plugins:/m);
      expect(config).toContain("production: cloudflare()");
      expect(config).not.toContain("target:");
      const pkg = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      );
      expect(pkg.dependencies.alepha).toBe(
        `file:${tarballs.alepha.replaceAll("\\", "/")}`,
      );
      if (options.preset === "saas")
        expect(pkg.dependencies["@alepha/ui"]).toBe(
          `file:${tarballs["@alepha/ui"].replaceAll("\\", "/")}`,
        );
      const installedCli = join(root, "node_modules/.bin", `alepha${suffix}`);
      await success(installedCli, ["typecheck"], root);
      await success(installedCli, ["build", "--runtime", "workerd"], root);
      const manifest = JSON.parse(
        await readFile(join(root, "dist/manifest.json"), "utf8"),
      );
      expect(manifest.runtimes).toEqual([
        { runtime: "workerd", entry: "index.workerd.js" },
      ]);
      expect(existsSync(join(root, "dist/main.cloudflare.js"))).toBe(true);
      const wrangler = JSON.parse(
        await readFile(join(root, "dist/wrangler.jsonc"), "utf8"),
      );
      expect(wrangler.main).toBe("./main.cloudflare.js");
      const plan = await success(
        installedCli,
        ["infra", "plan", "--json"],
        root,
      );
      expect(JSON.parse(plan.stdout)).toMatchObject({
        project: options.name,
        env: "production",
        environments: { production: { adapter: "cloudflare" } },
      });
      expect(existsSync(join(root, "node_modules/.alepha/platform.json"))).toBe(
        false,
      );
    },
  );

  it("runs installed create-alepha with explicit infra and keeps omission opt-in", async () => {
    await success(
      CREATE,
      [
        "created-app",
        "--yes",
        "--preset",
        "default",
        "--pm",
        "npm",
        "--infra=cf",
      ],
      WORK,
    );
    expect(await configAt(join(WORK, "created-app"))).toContain(
      "production: cloudflare()",
    );
    await success(CLI, ["init", "local-app", "--pm", "npm"], WORK);
    expect(await configAt(join(WORK, "local-app"))).not.toMatch(
      /^\s+plugins:/m,
    );
    for (const args of [
      ["--infra", "bay"],
      ["--platform", "cf"],
      ["--deploy", "cf"],
    ]) {
      expect(
        (await run(CLI, ["init", "invalid-app", ...args], WORK)).code,
      ).not.toBe(0);
      expect(
        (await run(CREATE, ["invalid-app", "--yes", ...args], WORK)).code,
      ).not.toBe(0);
      expect(existsSync(join(WORK, "invalid-app"))).toBe(false);
    }
  });

  it("edits aliases, preserves canonical reruns, refuses conflicts before install and honors force", async () => {
    const root = join(WORK, "default-app");
    const original = await configAt(root);
    const aliased = original
      .replace("defineConfig }", "defineConfig as config }")
      .replace("export default defineConfig(", "export default config(")
      .replace("cloudflare, infra }", "cloudflare as cf, infra as setup }")
      .replace("    infra({", "    setup({")
      .replace(
        "production: cloudflare()",
        'production: cf({ domain: "example.test" })',
      );
    await writeFile(join(root, "alepha.config.ts"), aliased);
    await success(CLI, ["init", "--infra=cloudflare", "--pm=npm"], root);
    const canonical = await configAt(root);
    await success(CLI, ["init", "--infra", "cf", "--pm", "npm"], root);
    expect(await configAt(root)).toBe(canonical);
    expect(canonical).toContain('domain: "example.test"');
    for (const config of [
      'import { defineConfig } from "alepha/cli/config"; import { platform } from "alepha/cli/platform"; export default defineConfig({ plugins: [platform({})] });',
      'import { defineConfig } from "alepha/cli/config"; const options = {}; export default defineConfig(options);',
      'import { defineConfig } from "alepha/cli/config"; import { infra, bay } from "alepha/cli/infra"; export default defineConfig({ plugins: [infra({ environments: { production: bay() } })] });',
    ]) {
      await writeFile(join(root, "alepha.config.ts"), config);
      const installs = await readFile(
        join(root, ".npm-installs.ndjson"),
        "utf8",
      );
      const entries = await readdir(root);
      expect(
        (await run(CLI, ["init", "--infra", "cf", "--pm", "npm"], root)).code,
      ).not.toBe(0);
      expect(await configAt(root)).toBe(config);
      expect(await readdir(root)).toEqual(entries);
      expect(await readFile(join(root, ".npm-installs.ndjson"), "utf8")).toBe(
        installs,
      );
    }
    await writeFile(join(root, ".env"), "KEEP_ME=yes\n");
    expect(
      (await run(CLI, ["init", "default-app", "--infra", "cf"], WORK)).code,
    ).not.toBe(0);
    await success(
      CLI,
      ["init", "--force", "--infra", "cf", "--pm", "npm"],
      root,
    );
    expect(await configAt(root)).toContain("production: cloudflare()");
    expect(await readFile(join(root, ".env"), "utf8")).toBe("KEEP_ME=yes\n");
  });

  it("preserves full, prebuilt and granular adapter behavior through the installed CLI", async () => {
    const root = join(WORK, "local-app");
    const localCli = join(root, "node_modules/.bin", `alepha${suffix}`);
    await writeFile(
      join(root, "alepha.config.ts"),
      `
import { $inject, $module, AlephaError, z } from "alepha";
import { defineConfig } from "alepha/cli/config";
import { infra } from "alepha/cli/infra";
import { InfraAdapter, type InfraContext } from "alepha/cli/infra-lib";
import { FileSystemProvider } from "alepha/system";
class RecordingAdapter extends InfraAdapter {
  static readonly id = "recording";
  static readonly options = z.object({});
  protected readonly fs = $inject(FileSystemProvider);
  protected async step(step: string, ctx: InfraContext) {
    const path = this.fs.join(ctx.root, "calls.ndjson");
    const before = await this.fs.exists(path) ? String(await this.fs.readFile(path)) : "";
    await this.fs.writeFile(path, before + JSON.stringify({ step, env: ctx.env, prebuilt: ctx.prebuilt ?? false }) + "\\n");
    if (process.env.INFRA_TEST_FAIL === step) throw new AlephaError("stopped at " + step);
  }
  async authenticate(ctx: InfraContext) { await this.step("authenticate", ctx); }
  async provision(ctx: InfraContext) { await this.step("provision", ctx); }
  async build(ctx: InfraContext) { await this.step("build", ctx); }
  async migrate(ctx: InfraContext) { await this.step("migrate", ctx); }
  async deploy(ctx: InfraContext) { await this.step("deploy", ctx); return "https://" + ctx.env + ".example.test"; }
  async secrets(ctx: InfraContext) { await this.step("secrets", ctx); }
  async teardown(ctx: InfraContext) { await this.step("teardown", ctx); }
  async login(ctx: InfraContext) { await this.step("login", ctx); }
  async logout(ctx: InfraContext) { await this.step("logout", ctx); }
  async inspect() { return { workers: [], databases: [], buckets: [], kvNamespaces: [], queues: [], secrets: [] }; }
}
$module({ name: "epic.recording", services: [RecordingAdapter] });
const descriptor = { adapter: RecordingAdapter, options: {} };
export default defineConfig({ plugins: [infra({ default: "prod", environments: { prod: descriptor, preview: descriptor } })] });
`,
    );
    const help = await success(localCli, ["--help"], root);
    expect(help.stdout.match(/^\s+alepha deploy\s/gm)).toHaveLength(1);
    expect(help.stdout.match(/^\s+alepha infra\s/gm)).toHaveLength(1);
    const full = await success(localCli, ["deploy", "--json"], root);
    expect(JSON.parse(full.stdout)).toEqual({
      status: "succeeded",
      project: "local-app",
      env: "prod",
      urls: ["https://prod.example.test"],
    });
    expect((await callsAt(root)).map((x) => x.step)).toEqual([
      "authenticate",
      "provision",
      "build",
      "migrate",
      "deploy",
      "secrets",
    ]);
    await clearCalls(root);
    const granular = await success(
      localCli,
      ["infra", "deploy", "-e", "preview", "--json"],
      root,
    );
    // Granular deploy preserves the existing adapter-output contract, with
    // no CLI JSON summary or synthesized URL, even when --json is accepted.
    expect(granular.stdout.trim()).toBe("");
    expect((await callsAt(root)).map((x) => x.step)).toEqual([
      "authenticate",
      "deploy",
    ]);
    // A valid manifest drives prebuilt context; no local server boot is needed.
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(
      join(root, "dist/manifest.json"),
      JSON.stringify({
        project: "local-app",
        runtimes: [{ runtime: "node", entry: "index.node.js" }],
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
          hasWebSocket: false,
        },
        secrets: [],
        variables: [],
      }),
    );
    await clearCalls(root);
    await success(
      localCli,
      ["deploy", "--env=preview", "--prebuilt", "--json"],
      root,
    );
    expect((await callsAt(root)).map((x) => x.step)).toEqual([
      "authenticate",
      "provision",
      "build",
      "migrate",
      "deploy",
      "secrets",
    ]);
    expect((await callsAt(root)).every((x) => x.prebuilt)).toBe(true);
    await clearCalls(root);
    expect(
      (
        await run(localCli, ["deploy", "--json"], root, {
          INFRA_TEST_FAIL: "migrate",
        })
      ).code,
    ).not.toBe(0);
    expect((await callsAt(root)).map((x) => x.step)).toEqual([
      "authenticate",
      "provision",
      "build",
      "migrate",
    ]);
    await clearCalls(root);
    for (const args of [
      ["deploy", "--env", "unknown"],
      ["deploy", "--wrong"],
      ["infra", "login"],
      ["infra", "logout"],
      ["infra", "down"],
      ["infra", "up"],
      ["infra", "auth", "login"],
    ])
      expect((await run(localCli, args, root)).code).not.toBe(0);
    expect(await callsAt(root)).toEqual([]);
    await success(localCli, ["infra", "login", "--env", "prod"], root);
    await success(localCli, ["infra", "logout", "--env=prod"], root);
    await success(
      localCli,
      ["infra", "down", "--env", "preview", "--yes", "--json"],
      root,
    );
    expect((await callsAt(root)).map((x) => x.step)).toEqual([
      "login",
      "logout",
      "authenticate",
      "teardown",
    ]);
  });
});
