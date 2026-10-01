import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import { Alepha } from "alepha";
import { parseSync } from "vite";
import { describe, it } from "vitest";

import { ViteUtils } from "../services/ViteUtils.ts";

const ROOT = "/app";

/**
 * The files the fake resolver knows about, as Vite's own resolver would:
 * a source path resolves only if the file is really there, under the
 * extension it really has.
 */
const FILES = new Set([
  "/app/src/pages/Home.tsx",
  "/app/src/pages/Legacy.js",
  "/app/src/AppRouter.ts",
]);

/**
 * A stand-in for the slice of the Rollup/rolldown plugin context the preload
 * plugin uses: the same `parse` both Vite's dev container and rolldown expose,
 * and a `resolve` that answers from {@link FILES} instead of the filesystem.
 */
const context = () => ({
  parse: (code: string, options?: any) =>
    parseSync("file.tsx", code, options).program,
  resolve: async (source: string, importer: string) => {
    const base = resolve(dirname(importer), source);
    for (const candidate of [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      `${base}.jsx`,
      `${base}.js`,
    ]) {
      if (FILES.has(candidate)) return { id: candidate };
    }
    return null;
  },
  warn: () => {},
});

const keyOf = (relativePath: string) =>
  createHash("md5").update(relativePath).digest("hex").slice(0, 8);

const transform = async (code: string, id = "/app/src/AppRouter.ts") => {
  const plugin = Alepha.create().inject(ViteUtils).createSsrPreloadPlugin();
  (plugin.configResolved as any)?.call(plugin, { root: ROOT });
  const handler: any = plugin.transform;
  return (await handler.call(context(), code, id)) as {
    code: string;
    map: unknown;
  } | null;
};

describe("SsrPreloadPlugin", () => {
  it("should inject the preload key of the resolved lazy import", async ({
    expect,
  }) => {
    const result = await transform(`
      const route = $page({
        path: "/",
        lazy: () => import("./pages/Home.tsx"),
      });
    `);

    expect(result).not.toBeNull();
    expect(result?.code).toContain(
      `[Symbol.for("alepha.page.preload")]: "${keyOf("src/pages/Home.tsx")}"`,
    );
  });

  it("should keep the sourcemap instead of dropping it", async ({ expect }) => {
    const result = await transform(`
      const route = $page({ lazy: () => import("./pages/Home.tsx") });
    `);

    expect(result?.map).toBeTruthy();
  });

  it("should ignore a $page written inside a JSDoc example", async ({
    expect,
  }) => {
    const result = await transform(`
      /**
       * @example
       * \`\`\`ts
       * $page({
       *   lazy: () => import("./pages/Ghost.tsx"),
       * });
       * \`\`\`
       */
      export const doc = 1;
    `);

    expect(result).toBeNull();
  });

  it("should not move the injection point when a string literal holds a brace", async ({
    expect,
  }) => {
    const result = await transform(`
      const route = $page({
        path: "/",
        meta: { title: "a } brace" },
        lazy: () => import("./pages/Home.tsx"),
      });
    `);

    const injected = `[Symbol.for("alepha.page.preload")]: "${keyOf("src/pages/Home.tsx")}"`;
    expect(result?.code).toContain(injected);
    // The key belongs to the $page object, not to the nested `meta` object.
    expect(result?.code).toContain(`a } brace" },`);
    expect(result?.code.indexOf(injected)).toBeGreaterThan(
      result!.code.indexOf(`import("./pages/Home.tsx")`),
    );
  });

  it("should keep the real extension of a lazily imported .js page", async ({
    expect,
  }) => {
    const result = await transform(`
      const route = $page({ lazy: () => import("./pages/Legacy.js") });
    `);

    expect(result?.code).toContain(`"${keyOf("src/pages/Legacy.js")}"`);
    expect(result?.code).not.toContain(`"${keyOf("src/pages/Legacy.ts")}"`);
  });

  it("should skip a lazy import that resolves to nothing", async ({
    expect,
  }) => {
    const result = await transform(`
      const route = $page({ lazy: () => import("./pages/Missing.tsx") });
    `);

    expect(result).toBeNull();
  });
});
