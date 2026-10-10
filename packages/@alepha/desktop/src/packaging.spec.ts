import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { rolldown } from "rolldown";
import { describe, it } from "vitest";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

/**
 * Bundle one entry with every bare import left external, and answer what
 * loading the entry reaches statically, and what it reaches only through a
 * lazy `import()`.
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
  const main = chunks.find((chunk) => chunk.isEntry)!;
  return {
    staticModules: main.moduleIds,
    staticImports: main.imports,
    lazyImports: [
      ...new Set(
        chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]),
      ),
    ],
  };
};

describe("@alepha/desktop packaging", () => {
  it("publishes with the framework's version", ({ expect }) => {
    const framework = JSON.parse(
      readFileSync(join(root, "..", "..", "alepha", "package.json"), "utf-8"),
    );
    expect(pkg.private).toBeUndefined();
    expect(pkg.version).toBe(framework.version);
    expect(pkg.peerDependencies.alepha).toBe(`^${framework.version}`);
  });

  it("exports the root, worker, shell and cli, in dev and in publishConfig", ({
    expect,
  }) => {
    const subpaths = [".", "./cli", "./package.json", "./shell", "./worker"];
    expect(Object.keys(pkg.exports).sort()).toEqual(subpaths);
    expect(Object.keys(pkg.publishConfig.exports).sort()).toEqual(subpaths);
  });

  it("pins the native dependency and ships its license notice", ({
    expect,
  }) => {
    // An exact version: the embedded libwebview.dylib is what Q2234 measured
    // (webview 0.12, minimum macOS 15.0), and a range could swap it silently.
    expect(pkg.dependencies["webview-bun"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.files).toContain("THIRD_PARTY_NOTICES.md");
    const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf-8");
    expect(notices).toContain("Copyright (c) 2017 Serge Zaitsev");
    expect(notices).toContain("Permission is hereby granted, free of charge");
  });

  it("keeps the protocol, the Worker side and the CLI adapter free of native code", async ({
    expect,
  }) => {
    for (const entry of [
      "src/core/index.ts",
      "src/worker/index.ts",
      "src/cli/index.ts",
    ]) {
      const graph = await graphOf(entry);
      expect(graph.lazyImports).not.toContain("bun:ffi");
      expect(graph.lazyImports.some((id) => id.startsWith("webview-bun"))).toBe(
        false,
      );
      expect(graph.staticModules.some((id) => id.includes("/shell/"))).toBe(
        false,
      );
    }
  });

  it("loads native code from the shell only lazily", async ({ expect }) => {
    const graph = await graphOf("src/shell/index.ts");

    expect(graph.staticImports).not.toContain("bun:ffi");
    expect(graph.staticImports.some((id) => id.startsWith("webview-bun"))).toBe(
      false,
    );
    expect(graph.staticModules.some((id) => id.includes("/native/"))).toBe(
      false,
    );
    // ...and still reaches them, so `bun build --compile` embeds them.
    expect(graph.lazyImports).toContain("bun:ffi");
    expect(graph.lazyImports).toContain("webview-bun");
    expect(graph.lazyImports).toContain("webview-bun/build/libwebview.dylib");
  });

  it("has the embedded library where the shell imports it from", ({
    expect,
  }) => {
    const dylib = join(
      root,
      "node_modules",
      "webview-bun",
      "build",
      "libwebview.dylib",
    );
    const hoisted = join(
      root,
      "..",
      "..",
      "..",
      "node_modules",
      "webview-bun",
      "build",
      "libwebview.dylib",
    );
    expect(existsSync(dylib) || existsSync(hoisted)).toBe(true);
  });
});
