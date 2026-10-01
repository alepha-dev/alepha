import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { build, createServer, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, it } from "vitest";

import { ViteUtils } from "../services/ViteUtils.ts";

/**
 * A `*.client.ts(x)` module does not exist on the server.
 *
 * The whole point is what the BUNDLER does, so these run real Vite against a
 * fixture on disk: a module that only answers the hook's own question could
 * pass while the chunk still ships. The marker is what a heavy browser-only
 * dependency looks like to the build - something imported by the `.client`
 * file and by nothing else.
 */
describe("ClientModulesPlugin", () => {
  const MARKER = "BROWSER_ONLY_DEPENDENCY_MARKER";
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "alepha-client-modules-"));
    // Published on `globalThis` so neither build can tree-shake the import
    // away: an app-mode browser build drops an entry's unused exports, and
    // with them the very `import()` this is about.
    await writeFile(
      join(root, "entry.ts"),
      'export const load = () => import("./Heavy.client.tsx");\n\n(globalThis as any).load = load;\n',
    );
    await writeFile(
      join(root, "Heavy.client.tsx"),
      'import { marker } from "./heavy.ts";\n\nexport default function Heavy() {\n  return marker;\n}\n',
    );
    await writeFile(
      join(root, "heavy.ts"),
      `export const marker = "${MARKER}";\n`,
    );
    await writeFile(
      join(root, "Named.client.ts"),
      "export const answer = 42;\n",
    );
    await writeFile(
      join(root, "named-entry.ts"),
      'import { answer } from "./Named.client.ts";\n\n(globalThis as any).answer = answer;\n',
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const plugin = () =>
    Alepha.create().inject(ViteUtils).createClientModulesPlugin();

  const codeOf = (output: unknown): string => {
    const outputs = (Array.isArray(output) ? output : [output]) as Array<
      Pick<Rolldown.RolldownOutput, "output">
    >;
    return outputs
      .flatMap((item) => item.output)
      .map((chunk) => ("code" in chunk ? chunk.code : ""))
      .join("\n");
  };

  it("leaves what a .client module imports out of the server build", async ({
    expect,
  }) => {
    const output = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin()],
      build: { ssr: join(root, "entry.ts"), write: false },
    });

    expect(codeOf(output)).not.toContain(MARKER);
  });

  it("keeps the real module in the browser build", async ({ expect }) => {
    const output = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin()],
      build: {
        write: false,
        rolldownOptions: { input: join(root, "entry.ts") },
      },
    });

    expect(codeOf(output)).toContain(MARKER);
  });

  it("fails the server build when server code imports a .client module by name", async ({
    expect,
  }) => {
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [plugin()],
        build: { ssr: join(root, "named-entry.ts"), write: false },
      }),
    ).rejects.toThrow(/answer/);
  });

  it("hands the dev server a component that renders nothing, and the browser the real one", async ({
    expect,
  }) => {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      appType: "custom",
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [plugin()],
    });

    try {
      const mod = await server.ssrLoadModule(join(root, "Heavy.client.tsx"));
      expect(mod.default()).toBeNull();

      const browser =
        await server.environments.client.transformRequest("/Heavy.client.tsx");
      expect(browser?.code).toContain("heavy.ts");
    } finally {
      await server.close();
    }
  });

  it("recognises the app's own .client files and nothing else", ({
    expect,
  }) => {
    const vite = Alepha.create().inject(ViteUtils);

    expect(vite.isClientModule("/app/src/Chart.client.tsx")).toBe(true);
    expect(vite.isClientModule("/app/src/setup.client.ts")).toBe(true);
    expect(vite.isClientModule("/app/src/Chart.client.tsx?v=1a2b")).toBe(true);

    expect(vite.isClientModule("/app/src/Chart.tsx")).toBe(false);
    expect(vite.isClientModule("/app/src/client.tsx")).toBe(false);
    expect(vite.isClientModule("/app/src/client.spec.tsx")).toBe(false);
    expect(
      vite.isClientModule("/app/node_modules/some-lib/index.client.js"),
    ).toBe(false);
  });
});
