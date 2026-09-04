/**
 * End-to-end tests for the `lore` binary, against the artifact npm would ship.
 *
 * `npm i -g "@alepha/lore"` is the headline of the standalone-CLI change, and
 * a global install is the one claim nothing else in this repository exercises.
 * It only breaks on somebody else's machine, after publish, which is the worst
 * place to find out.
 *
 * Same method as `cli.e2e.spec.ts`: `yarn pack` (which applies
 * `publishConfig`, where `npm pack` does not) into a throwaway project outside
 * the workspace globs. Two things here can only be seen from that side:
 *
 *   1. **`publishConfig.bin`.** In the monorepo `node_modules/.bin/lore` points
 *      at `src/bin/index.ts`, type-stripped by node. What a user gets is
 *      `dist/bin/index.js`, and nothing else runs it.
 *   2. **The command surface.** `commandSurface.spec.ts` asserts the same five
 *      commands, but against the workspace container. Here a missing `dist/bin`
 *      or a botched `bin` mapping fails first, and for a different reason.
 *
 * ⚠️ This is a SUBSET of the release rehearsal, not a replacement for it. It
 * proves a local install with npm only. Yarn, pnpm and Bun each resolve and
 * link differently, and a global install has no host project to satisfy
 * anything from, which is the whole reason `alepha` is a dependency here and
 * not a peer. That belongs on verdaccio, before a release.
 *
 * Requires `yarn build` first: the tarball carries `dist/`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(thisFile), "../../..");
// The sibling of `cli.e2e.spec.ts`'s own directory, and separate on purpose:
// vitest runs spec files in parallel workers, and both suites wipe their work
// directory on the way in.
const WORK_DIR = join(ROOT, ".e2e-tmp", "lore");
const TARBALL_DIR = join(WORK_DIR, "tarballs");
const PROJECT_DIR = join(WORK_DIR, "proj");
const isWindows = process.platform === "win32";

/**
 * The binary as a consumer invokes it. Never `yarn lore`, which would walk
 * back up to the workspace copy and quietly test the source again.
 */
const LORE = join(
  PROJECT_DIR,
  "node_modules",
  ".bin",
  isWindows ? "lore.cmd" : "lore",
);

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
        // Blanked, not merely unset: whoever runs this suite by hand may well
        // have exported them for real, and the help output must not depend on
        // whether they have.
        LORE_PROJECT: "",
        LORE_API_KEY: "",
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
 * Every installed copy of a package, by directory.
 *
 * Walks rather than trusting the lockfile, because the lockfile records what
 * the resolver decided and this has to report what is on disk. Nested
 * `node_modules` are exactly what it is looking for.
 */
function copiesOf(pkg: string, dir: string): string[] {
  const modules = join(dir, "node_modules");
  if (!existsSync(modules)) {
    return [];
  }
  const found: string[] = [];
  const entries = readdirSync(modules).flatMap((name) =>
    name.startsWith("@")
      ? readdirSync(join(modules, name)).map((scoped) => `${name}/${scoped}`)
      : [name],
  );
  for (const name of entries) {
    const path = join(modules, name);
    if (!statSync(path).isDirectory()) {
      continue;
    }
    if (name === pkg) {
      found.push(path);
    }
    found.push(...copiesOf(pkg, path));
  }
  return found;
}

describe("the lore binary, as installed", () => {
  beforeAll(async () => {
    if (existsSync(WORK_DIR)) {
      await rm(WORK_DIR, { recursive: true, force: true });
    }

    for (const built of [
      "packages/alepha/dist/bin/index.js",
      "packages/@alepha/lore/dist/bin/index.js",
    ]) {
      if (!existsSync(join(ROOT, built))) {
        throw new Error(
          `${built} is missing — run \`yarn build\` before \`yarn e2e-cli\`.\n` +
            "These tests install a packed tarball, and the tarball carries dist/.",
        );
      }
    }

    await mkdir(TARBALL_DIR, { recursive: true });
    await mkdir(PROJECT_DIR, { recursive: true });

    // `yarn pack`, not `npm pack`: the `publishConfig` overrides that repoint
    // `bin` and the `exports` map at `dist/` are a yarn extension, and npm
    // ignores them. An npm-packed tarball would still point at `src/*.ts`.
    for (const [workspace, file] of [
      ["alepha", "alepha.tgz"],
      ["@alepha/lore", "lore.tgz"],
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
      `${JSON.stringify({ name: "lore-consumer", version: "1.0.0", private: true }, null, 2)}\n`,
    );

    // Both tarballs, which is the shape a sigil consumer has: its own `alepha`
    // plus `@alepha/lore`. Installing only the second would resolve `alepha`
    // from the registry and test the previously published build.
    const installed = await run(
      `npm install "${join(TARBALL_DIR, "alepha.tgz")}" "${join(TARBALL_DIR, "lore.tgz")}"`,
      PROJECT_DIR,
    );
    if (installed.exitCode !== 0) {
      throw new Error(
        `Failed to install the packed tarballs:\n${installed.stdout}\n${installed.stderr}`,
      );
    }
  }, 300_000);

  afterAll(async () => {
    if (isWindows && process.env.CI) {
      return;
    }
    if (existsSync(WORK_DIR)) {
      await rm(WORK_DIR, { recursive: true, force: true });
    }
  });

  it("maps `lore` to dist, not src", async () => {
    const pkg = JSON.parse(
      await readFile(
        join(PROJECT_DIR, "node_modules/@alepha/lore/package.json"),
        "utf-8",
      ),
    );

    // If `publishConfig` had not been applied this would still say `src/`,
    // which is the single failure mode that breaks every consumer at once.
    expect(pkg.bin.lore).toContain("dist/");
    expect(existsSync(LORE)).toBe(true);
  });

  /**
   * `commandSurface.spec.ts` asserts the same five against the workspace
   * container. This asserts them against the tarball, where a missing
   * `dist/bin` or a bad `bin` mapping fails first and for a different reason.
   */
  it("answers --help with the five Lore commands", async () => {
    const result = await run(`"${LORE}" --help`, PROJECT_DIR);

    expect(result.exitCode).toBe(0);
    for (const command of [
      "quality",
      "artifacts",
      "releases",
      "login",
      "logout",
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  /**
   * ⚠️ The reason `WorkspacePacker` exists. `Alepha.inject` registers the
   * module that declares a service, so injecting one command from `alepha/cli`
   * would have shipped `build`, `dev`, `db` and `verify` inside this binary,
   * under a second name and a second release cadence. Measured before the fix:
   * 25 commands.
   */
  it("carries none of the Alepha CLI's own commands", async () => {
    const result = await run(`"${LORE}" --help`, PROJECT_DIR);

    for (const leaked of ["build", "dev", "pack", "verify", "typecheck"]) {
      expect(result.stdout).not.toContain(`lore ${leaked}`);
    }
  });

  /**
   * The claim that decided `^0.28.0` over an exact pin in the manifest.
   *
   * A sigil consumer already has `alepha`, and a caret dedupes with it across
   * any `0.28.x` where a pin would guarantee a second copy: two containers,
   * two sets of primitives, and a `$module` identity that no longer matches
   * across the boundary. Asserted rather than assumed, and read off the disk
   * rather than off the lockfile.
   */
  it("leaves the consumer with exactly one alepha", () => {
    expect(copiesOf("alepha", PROJECT_DIR)).toHaveLength(1);
  });
});
