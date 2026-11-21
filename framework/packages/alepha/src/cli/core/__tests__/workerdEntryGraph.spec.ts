import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, it } from "vitest";

/**
 * What a Cloudflare Worker can bundle out of `alepha/cli` and
 * `alepha/cli/infra-lib`, asserted by walking the real import graph.
 *
 * ⚠️ **A build-time property with no runtime symptom to test for.** The code
 * that reaches `node:child_process` would run correctly if it ever ran; it
 * simply cannot be bundled for workerd, and the failure surfaces as a deploy
 * that dies during script validation rather than as a red test. `yarn v` never
 * builds for cloudflare, so without this spec only CI catches it, on the far
 * side of a merge.
 *
 * ⚠️ **And a type-level check would not do**, which is the trap folio #82
 * records: `tsc` resolves ONE export condition, so a `workerd` entry that
 * drifts from its Node sibling typechecks on whichever side is compiled. The
 * guard has to read the files.
 *
 * The walker resolves `alepha/...` specifiers through this package's own
 * `exports` map with the `workerd` condition preferred, which is what makes the
 * answer the bundler's answer rather than Node's: `alepha/system` is clean
 * under workerd and reaches `node:fs` under Node, and only the first is true
 * here.
 */
describe("the workerd entries of the CLI", () => {
  const pkgRoot = resolve(__dirname, "../../../..");
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8"),
  ) as { name: string; exports: Record<string, any> };

  /**
   * The only `node:` builtin allowed to reach a workerd entry.
   *
   * `AsyncLocalStorage` is supported on Workers and `alepha/core`'s own
   * workerd entry already depends on it, so a blanket ban would fail on code
   * that is correct. Everything else is denied: adding an entry here is a
   * decision about what the runtime provides, and it belongs in a diff
   * somebody reads.
   */
  const ALLOWED_BUILTINS = new Set(["node:async_hooks"]);

  /**
   * The dynamic imports the walk does not follow, as `<file> -> <specifier>`.
   *
   * A dynamic `import()` is walked like a static one, since a bundler links
   * its target into the same Worker. These two are known, and are a decision
   * for the owner of each file, not a statement that they are safe:
   *
   * - `FileDetector.peekBytes` imports `node:stream` on its first call, so
   *   that the browser index, which ships the same file, does not. Nothing
   *   keeps a Worker from calling it.
   * - `WorkerCloudflareAdapter.postgresUrl` imports `alepha/orm` to read a
   *   `DATABASE_URL`. That subpath has no `workerd` entry, so the edge leads
   *   into the Node index of the ORM and every builtin its drivers import.
   *
   * An entry whose edge is gone fails the last test of this file.
   */
  const UNFOLLOWED_DYNAMIC_IMPORTS = new Set([
    "src/system/services/FileDetector.ts -> node:stream",
    "src/cli/infra-lib/adapters/WorkerCloudflareAdapter.ts -> alepha/orm",
  ]);

  /**
   * Import and re-export specifiers, minus the ones erased at compile time.
   *
   * Comments and template literals are stripped first. Both are load-bearing:
   * `InfraInspector` prints a config example containing an `import` line
   * inside a template literal, and a naive match reports it as a dependency on
   * `alepha/cli/infra` - which is how this walker first "found" the entire
   * CLI in the orchestrator's closure.
   */
  const specifiersOf = (
    source: string,
  ): Array<{ specifier: string; dynamic: boolean }> => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    const pattern =
      /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([^;]*?)\s*from\s*["'`]([^"'`]+)["'`]/g;
    const found: Array<{ specifier: string; dynamic: boolean }> = [];
    for (const match of code.matchAll(pattern)) {
      const clause = match[1].trim();
      // `import { type A, type B } from "x"` is erased too.
      if (/^\{[^}]*\}$/.test(clause)) {
        const names = clause
          .slice(1, -1)
          .split(",")
          .map((it) => it.trim())
          .filter(Boolean);
        if (names.length > 0 && names.every((it) => it.startsWith("type "))) {
          continue;
        }
      }
      found.push({ specifier: match[2], dynamic: false });
    }
    // `import "x"`, for its side effects.
    for (const match of code.matchAll(
      /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    )) {
      found.push({ specifier: match[1], dynamic: false });
    }
    // `import("x")`: a bundler follows it into a chunk of the same Worker.
    // `typeof import("x")` is a type, erased with the rest.
    for (const match of code.matchAll(
      /(?<!typeof\s)\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    )) {
      found.push({ specifier: match[1], dynamic: true });
    }
    return found;
  };

  /**
   * Whether an import is one of {@link UNFOLLOWED_DYNAMIC_IMPORTS}. Only its
   * dynamic form is: a static import of the same specifier from the same
   * file is walked like any other.
   */
  const isUnfollowed = (
    file: string,
    edge: { specifier: string; dynamic: boolean },
  ): boolean =>
    edge.dynamic &&
    UNFOLLOWED_DYNAMIC_IMPORTS.has(`${file} -> ${edge.specifier}`);

  /**
   * Resolve one of this package's own subpaths the way a workerd bundler does.
   */
  const resolveSelf = (specifier: string): string | undefined => {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) {
      return undefined;
    }
    const key =
      specifier === pkg.name ? "." : `.${specifier.slice(pkg.name.length)}`;
    const entry = pkg.exports[key];
    if (!entry) return undefined;
    const file =
      typeof entry === "string"
        ? entry
        : (entry.workerd ?? entry.import ?? entry.default);
    return typeof file === "string" ? join(pkgRoot, file) : undefined;
  };

  const walk = (entry: string) => {
    const visited = new Set<string>();
    const builtins = new Map<string, Set<string>>();
    const external = new Set<string>();
    const unfollowed = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop();
      if (!file || visited.has(file) || !existsSync(file)) continue;
      visited.add(file);
      const relative = file.slice(pkgRoot.length + 1);
      for (const edge of specifiersOf(readFileSync(file, "utf8"))) {
        const { specifier } = edge;
        if (isUnfollowed(relative, edge)) {
          unfollowed.add(`${relative} -> ${specifier}`);
          continue;
        }
        if (specifier.startsWith("node:")) {
          const seen = builtins.get(specifier) ?? new Set<string>();
          seen.add(relative);
          builtins.set(specifier, seen);
          continue;
        }
        const target = specifier.startsWith(".")
          ? join(dirname(file), specifier)
          : resolveSelf(specifier);
        if (target) queue.push(target);
        else external.add(specifier);
      }
    }
    return { visited, builtins, external, unfollowed };
  };

  const entries = {
    "alepha/cli": join(pkgRoot, "src/cli/core/index.workerd.ts"),
    "alepha/cli/infra-lib": join(pkgRoot, "src/cli/infra-lib/index.workerd.ts"),
  };

  for (const [name, entry] of Object.entries(entries)) {
    it(`reaches no unsupported node: builtin from ${name}`, ({ expect }) => {
      const { builtins } = walk(entry);
      const offenders = [...builtins]
        .filter(([specifier]) => !ALLOWED_BUILTINS.has(specifier))
        .map(
          ([specifier, files]) => `${specifier} <- ${[...files].join(", ")}`,
        );

      expect(offenders).toEqual([]);
    });

    it(`reaches neither the shell nor wrangler from ${name}`, ({ expect }) => {
      // Named one by one rather than left to the builtin assertion, because
      // these are the ones the epic's plan calls out and a failure should say
      // which came back rather than which builtin it dragged in behind it.
      const { visited, external } = walk(entry);
      const reached = (file: string) =>
        [...visited].some((it) => it.endsWith(`/${file}`));

      expect(reached("WranglerApi.ts")).toBe(false);
      expect(reached("NodeShellProvider.ts")).toBe(false);
      expect(reached("BayAdapter.ts")).toBe(false);
      expect(reached("ViteBuildProvider.ts")).toBe(false);
      expect(external.has("vite")).toBe(false);
    });
  }

  it("keeps BuildCloudflareTask reachable, since that is the point", ({
    expect,
  }) => {
    // A workerd entry that reached no builtin because it exported nothing
    // would pass every assertion above.
    const { visited } = walk(entries["alepha/cli"]);

    expect(
      [...visited].some((file) => file.endsWith("/BuildCloudflareTask.ts")),
    ).toBe(true);
  });

  it("keeps InfraOrchestrator reachable from infra-lib", ({ expect }) => {
    const { visited } = walk(entries["alepha/cli/infra-lib"]);

    expect(
      [...visited].some((file) => file.endsWith("/InfraOrchestrator.ts")),
    ).toBe(true);
  });

  it("keeps the worker-side adapter and its two clients reachable", ({
    expect,
  }) => {
    // An entry that dropped the adapter would pass every assertion above by
    // reaching nothing at all, and a deploy to Cloudflare would then find no
    // adapter, which reads as a config problem rather than a missing export.
    const { visited } = walk(entries["alepha/cli/infra-lib"]);
    const reached = (file: string) =>
      [...visited].some((it) => it.endsWith(`/${file}`));

    expect(reached("WorkerCloudflareAdapter.ts")).toBe(true);
    expect(reached("CloudflareProvisionClient.ts")).toBe(true);
    expect(reached("CloudflareDeployClient.ts")).toBe(true);
    expect(reached("D1MigrationsService.ts")).toBe(true);
    // ...and the Node shell over them, which reads the developer's
    // environment and shells out to wrangler for a login (#E75).
    expect(reached("CloudflareAdapter.ts")).toBe(false);
    expect(reached("CloudflareCredentialSource.ts")).toBe(false);
  });

  it("walks dynamic imports, and still meets every one it does not follow", ({
    expect,
  }) => {
    expect(
      specifiersOf(
        'const a = await import("./a.ts");\nimport "./b.ts";\nlet c: typeof import("./c.ts");',
      ),
    ).toEqual([
      { specifier: "./b.ts", dynamic: false },
      { specifier: "./a.ts", dynamic: true },
    ]);

    // The exemption is for the lazy form alone: the same specifier imported
    // statically from the same file is an ordinary edge.
    const [edge] = [...UNFOLLOWED_DYNAMIC_IMPORTS];
    const [file, specifier] = edge.split(" -> ");
    expect(isUnfollowed(file, { specifier, dynamic: true })).toBe(true);
    expect(isUnfollowed(file, { specifier, dynamic: false })).toBe(false);

    const met = new Set(
      Object.values(entries).flatMap((entry) => [...walk(entry).unfollowed]),
    );

    expect([...met].sort()).toEqual([...UNFOLLOWED_DYNAMIC_IMPORTS].sort());
  });
});
