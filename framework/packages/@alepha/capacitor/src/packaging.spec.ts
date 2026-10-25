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
    // Lazy `import()`s count: a native plugin or sharp loaded on first use is
    // still reached.
    imports: [
      ...new Set(
        chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]),
      ),
    ],
  };
};

describe("@alepha/capacitor packaging", () => {
  it("publishes with the framework's version", ({ expect }) => {
    // release.yml bumps and publishes every non-private workspace together:
    // a version of its own would drift from the alepha it peers on.
    const framework = JSON.parse(
      readFileSync(join(root, "..", "..", "alepha", "package.json"), "utf-8"),
    );
    expect(pkg.private).toBeUndefined();
    expect(pkg.version).toBe(framework.version);
    expect(pkg.peerDependencies.alepha).toBe(`^${framework.version}`);
  });

  it("exports the root, core, cli and the three OTA entries", ({ expect }) => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      [
        ".",
        "./cli",
        "./core",
        "./ota",
        "./ota-api",
        "./ota-admin",
        "./package.json",
      ].sort(),
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

  it("keeps core free of every OTA entry", async ({ expect }) => {
    // core must run without any updater: an app that never imports `ota`
    // ships no updater code and no server or admin code.
    const { modules, imports } = await graphOf("src/core/index.ts");

    expect(
      modules.filter((id) => /\/src\/ota(-api|-admin)?\//.test(id)),
    ).toEqual([]);
    expect(imports.filter((id) => id.startsWith("@capgo/"))).toEqual([]);
  });

  it("keeps the device client free of server and admin code", async ({
    expect,
  }) => {
    const { modules, imports } = await graphOf("src/ota/index.ts");

    expect(
      modules.filter((id) => /\/src\/(ota-api|ota-admin|cli)\//.test(id)),
    ).toEqual([]);
    expect(
      imports.filter(
        (id) =>
          id.startsWith("node:") ||
          builtinModules.includes(id) ||
          id.startsWith("alepha/orm") ||
          id.startsWith("alepha/cli") ||
          id.startsWith("@capgo/cli"),
      ),
    ).toEqual([]);
  });

  it("keeps ota-api to ota's protocol schemas, and away from ota-admin", async ({
    expect,
  }) => {
    const { modules, imports } = await graphOf("src/ota-api/index.ts");

    expect(
      modules.filter(
        (id) =>
          (id.includes("/src/ota/") && !id.includes("/src/ota/protocol/")) ||
          id.includes("/src/ota-admin/") ||
          id.includes("/src/cli/"),
      ),
    ).toEqual([]);
    // The server runs on workerd too: no Node built-in, and never the
    // publisher's tooling.
    expect(
      imports.filter(
        (id) =>
          id.startsWith("node:") ||
          builtinModules.includes(id) ||
          id.startsWith("@capgo/") ||
          id.startsWith("@capacitor/"),
      ),
    ).toEqual([]);
  });

  it("keeps ota-admin to browser code: the server is only a type", async ({
    expect,
  }) => {
    const { modules, imports } = await graphOf("src/ota-admin/index.ts");

    expect(modules.filter((id) => /\/src\/(ota-api|cli)\//.test(id))).toEqual(
      [],
    );
    expect(
      imports.filter(
        (id) =>
          id.startsWith("node:") ||
          builtinModules.includes(id) ||
          id.startsWith("alepha/orm") ||
          id.startsWith("alepha/api/") ||
          id.startsWith("@capgo/"),
      ),
    ).toEqual([]);
  });

  it("builds the cli entry on its own", async ({ expect }) => {
    const { modules, imports } = await graphOf("src/cli/index.ts");

    expect(modules.some((id) => id.includes("/src/cli/"))).toBe(true);
    expect(imports).toContain("alepha/cli");
  });

  it("reaches sharp from the cli only, and never @capacitor/assets or Trapeze", async ({
    expect,
  }) => {
    // The icon generator is the cli's; @capacitor/assets was rejected for its
    // Capacitor 5 CLI and its Trapeze dependency.
    const cli = await graphOf("src/cli/index.ts");
    const core = await graphOf("src/core/index.ts");
    const rejected = (id: string) =>
      id.startsWith("@capacitor/assets") || id.startsWith("@trapezedev/");

    expect(cli.imports).toContain("sharp");
    expect(core.imports).not.toContain("sharp");
    expect([...cli.imports, ...core.imports].filter(rejected)).toEqual([]);
    expect(Object.keys(pkg.dependencies)).toEqual(["sharp"]);
    expect(pkg.dependencies.sharp).toMatch(/^\d+\.\d+\.\d+$/);
    expect(
      Object.keys({ ...pkg.devDependencies, ...pkg.peerDependencies }).filter(
        rejected,
      ),
    ).toEqual([]);
  });

  it("keeps alepha/react/auth free of Capacitor", async ({ expect }) => {
    // Native token custody lives here, behind a seam the framework's auth
    // calls; the framework itself never learns Capacitor exists.
    const { imports } = await graphOf("../../alepha/src/react/auth/index.ts");

    expect(imports.filter((id) => id.startsWith("@capacitor/"))).toEqual([]);
  });
});
