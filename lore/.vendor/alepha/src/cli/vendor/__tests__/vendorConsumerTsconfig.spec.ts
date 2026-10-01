import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, it } from "vitest";

/**
 * `alepha vendor sync` builds each vendored package in place, under the
 * consumer's `.vendor/<pkg>` (see `VendorService.build`). A package tsconfig
 * extending `../../tsconfig.json` reads the monorepo root here, and the
 * CONSUMER's root there: one without `allowImportingTsExtensions`, and maybe
 * with `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`. The build
 * then dies on thousands of errors in code that is fine (#Q2490).
 *
 * These run the real compiler against the real package tsconfigs, copied into
 * a directory laid out the way a consumer lays it out.
 */
describe("vendored package tsconfig", () => {
  const packagesDir = fileURLToPath(
    new URL("../../../../../", import.meta.url),
  );
  const repoRoot = join(packagesDir, "..");
  const require = createRequire(import.meta.url);
  const tscBin = join(
    dirname(require.resolve("typescript/package.json")),
    "bin/tsc",
  );

  const consumers: string[] = [];

  afterEach(() => {
    for (const dir of consumers.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Code the framework is allowed to write, and a strict consumer config is
   * not: a `.ts` import specifier, an explicit `undefined` in an optional
   * property, an unchecked index access. Plus `process`, so a `types` entry
   * that fails to resolve shows up too.
   */
  const writeSources = (pkgDir: string) => {
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(
      join(pkgDir, "src/greet.ts"),
      "export const greet = (name: string): string => `hello ${name}`;\n",
    );
    writeFileSync(
      join(pkgDir, "src/index.ts"),
      [
        'import { greet } from "./greet.ts";',
        "export interface Options { name?: string }",
        "export const options: Options = { name: undefined };",
        'const names: string[] = ["world"];',
        "export const first: string = names[0];",
        "export const hello = greet(first);",
        "export const cwd = process.cwd();",
        "",
      ].join("\n"),
    );
  };

  /**
   * A consumer: a strict root tsconfig, `alepha` and `@alepha/ui` under
   * `.vendor/` with their real tsconfig files, and a `node_modules` where
   * `alepha` is the vendored copy, as a workspace install leaves it.
   */
  const createConsumer = () => {
    const root = mkdtempSync(join(tmpdir(), "alepha-vendor-consumer-"));
    consumers.push(root);

    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          noPropertyAccessFromIndexSignature: true,
        },
      }),
    );

    const alepha = join(root, ".vendor/alepha");
    mkdirSync(alepha, { recursive: true });
    for (const file of [
      "package.json",
      "tsconfig.json",
      "tsconfig.base.json",
    ]) {
      cpSync(join(packagesDir, "alepha", file), join(alepha, file));
    }
    writeSources(alepha);

    const ui = join(root, ".vendor/@alepha/ui");
    mkdirSync(ui, { recursive: true });
    for (const file of ["package.json", "tsconfig.json"]) {
      cpSync(join(packagesDir, "@alepha/ui", file), join(ui, file));
    }
    writeSources(ui);

    mkdirSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(alepha, join(root, "node_modules/alepha"), "dir");
    symlinkSync(
      join(repoRoot, "node_modules/@types"),
      join(root, "node_modules/@types"),
      "dir",
    );

    return { root, alepha, ui };
  };

  const tsc = (project: string): { ok: boolean; output: string } => {
    try {
      execFileSync(process.execPath, [tscBin, "-p", project, "--noEmit"], {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { ok: true, output: "" };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      return {
        ok: false,
        output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
      };
    }
  };

  it("fails when a package tsconfig extends the consumer's root", ({
    expect,
  }) => {
    // The control: the shape every package tsconfig had before #Q2490. It
    // proves the consumer above is strict enough to break a build, so the
    // next two cannot pass on a fixture that breaks nothing.
    const { alepha } = createConsumer();
    const naive = join(alepha, "tsconfig.naive.json");
    writeFileSync(
      naive,
      JSON.stringify({ extends: "../../tsconfig.json", include: ["src"] }),
    );

    const result = tsc(naive);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("TS5097");
  });

  it("typechecks a vendored alepha under a strict consumer", ({ expect }) => {
    const { alepha } = createConsumer();

    const result = tsc(join(alepha, "tsconfig.json"));

    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  });

  it("typechecks a vendored @alepha/ui under a strict consumer", ({
    expect,
  }) => {
    const { ui } = createConsumer();

    const result = tsc(join(ui, "tsconfig.json"));

    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  });

  /**
   * The rule, for every package a consumer can vendor: `vendorOptions`
   * accepts any directory under `packages/`, so a new package extending a
   * config above its own directory brings the bug back.
   */
  it("never lets a package tsconfig reach above its package", ({ expect }) => {
    const packageDirs = readdirSync(packagesDir).flatMap((name) =>
      name.startsWith("@")
        ? readdirSync(join(packagesDir, name)).map((it) => join(name, it))
        : [name],
    );

    const offenders: string[] = [];
    for (const pkg of packageDirs) {
      const dir = join(packagesDir, pkg);
      if (!existsSync(join(dir, "package.json"))) {
        continue;
      }
      for (const file of readdirSync(dir)) {
        if (!/^tsconfig.*\.json$/.test(file)) {
          continue;
        }
        const content = readFileSync(join(dir, file), "utf8");
        const extended = /"extends"\s*:\s*"([^"]+)"/.exec(content)?.[1];
        if (extended?.startsWith("../")) {
          offenders.push(`${pkg}/${file} -> ${extended}`);
        }
      }
    }

    expect(packageDirs.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});
