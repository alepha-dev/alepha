import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

import { rolldown } from "rolldown";
import { describe, it } from "vitest";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

/**
 * Bundle one entry with every bare import left external, and answer what the
 * entry actually reaches: its own source modules, and the packages it imports.
 *
 * The graph, not `package.json`: a string in the export map says where an
 * entry points, never what loading it drags in.
 */
const graphOf = async (entry: string) => {
  const bundle = await rolldown({
    input: join(root, entry),
    external: (id) => !id.startsWith(".") && !id.startsWith("/"),
    logLevel: "silent",
  });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  const chunks = output.filter((it) => it.type === "chunk");
  return {
    modules: chunks.flatMap((chunk) => chunk.moduleIds),
    imports: [...new Set(chunks.flatMap((chunk) => chunk.imports))],
  };
};

describe("@alepha/capacitor packaging", () => {
  it("stays private until its documentation publishes it", ({ expect }) => {
    // release.yml publishes every non-private workspace: a version here would
    // ship a native package to npm before any device proof.
    expect(pkg.private).toBe(true);
    expect(pkg.version).toBeUndefined();
  });

  it("exports the root, core and cli, and nothing an updater would add", ({
    expect,
  }) => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      [".", "./cli", "./core", "./package.json"].sort(),
    );
    expect(Object.keys(pkg.publishConfig.exports).sort()).toEqual(
      Object.keys(pkg.exports).sort(),
    );
    // The root is core under another name.
    expect(pkg.exports["."]).toEqual(pkg.exports["./core"]);
    expect(pkg.publishConfig.exports["."]).toEqual(
      pkg.publishConfig.exports["./core"],
    );
  });

  it("points every source export at a file that exists", ({ expect }) => {
    for (const [key, target] of Object.entries(pkg.exports)) {
      const file = typeof target === "string" ? target : (target as any).import;
      expect(existsSync(join(root, file)), `${key} -> ${file}`).toBe(true);
    }
  });

  it("keeps core's graph free of the cli and of Node", async ({ expect }) => {
    // core runs in a WebView. One import of the cli would pull the build
    // pipeline, the shell and the file system into the app's bundle.
    const { modules, imports } = await graphOf("src/core/index.ts");

    expect(modules.filter((id) => id.includes("/src/cli/"))).toEqual([]);
    expect(
      imports.filter(
        (id) =>
          id.startsWith("node:") ||
          builtinModules.includes(id) ||
          id.startsWith("alepha/cli") ||
          id === "sharp" ||
          id.startsWith("@capacitor/cli"),
      ),
    ).toEqual([]);
  });

  it("builds the cli entry on its own", async ({ expect }) => {
    const { modules, imports } = await graphOf("src/cli/index.ts");

    expect(modules.some((id) => id.includes("/src/cli/"))).toBe(true);
    expect(imports).toContain("alepha/cli");
  });
});
