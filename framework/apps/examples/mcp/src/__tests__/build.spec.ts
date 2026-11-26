import { type ChildProcess, spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, it } from "vitest";

/**
 * `alepha build` turns the `sales_report` view into one HTML document
 * embedded in each server slice, in place of `import("./views/SalesChart.tsx")`:
 * neither React nor the component is a module of the server bundle, and the
 * built server serves the view as `ui://tools/sales_report`.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "../../../packages/alepha/src/bin/index.ts");
const dist = "dist";

/**
 * The environment of a child process: the CLI and the built server must not
 * see this test run's markers (`VITEST`, `NODE_ENV=test`), which turn on
 * their test doubles.
 */
const childEnv = (env: Record<string, string> = {}) => {
  const out: Record<string, string | undefined> = { ...process.env, ...env };
  for (const key of Object.keys(out)) {
    if (key.startsWith("VITEST") || key === "NODE_ENV" || key === "TEST") {
      delete out[key];
    }
  }
  return out;
};

const exec = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: childEnv(),
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(output)),
    );
  });

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

/**
 * Every module the slice's chunks were made of, from their source maps.
 */
const modulesOf = (runtime: string): string[] => {
  const dir = join(root, dist, "server", runtime);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".js.map"))
    .flatMap(
      (file) =>
        JSON.parse(readFileSync(join(dir, file), "utf8")).sources as string[],
    );
};

const codeOf = (runtime: string): string => {
  const dir = join(root, dist, "server", runtime);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");
};

describe("mcp-example build", () => {
  let server: ChildProcess | undefined;

  beforeAll(async () => {
    rmSync(join(root, dist), { recursive: true, force: true });
    await exec(["build", "--runtime", "node,workerd"]);
  }, 240_000);

  afterAll(() => {
    server?.kill();
  });

  it("keeps React and the view's component out of every server slice", ({
    expect,
  }) => {
    for (const runtime of ["node", "workerd"]) {
      const modules = modulesOf(runtime);
      expect(modules.length).toBeGreaterThan(0);
      expect(
        modules.filter((it) =>
          /node_modules\/react(-dom)?\/|SalesChart|mcp\/view\//.test(it),
        ),
      ).toEqual([]);
      // The view is there, as text: its inlined stylesheet's banner.
      expect(codeOf(runtime)).toContain("tailwindcss v4");
    }
  });

  it("serves the built view from the node slice", async ({ expect }) => {
    const port = await freePort();
    server = spawn(process.execPath, [join(root, dist, "index.node.js")], {
      cwd: root,
      env: childEnv({
        SERVER_PORT: String(port),
        SERVER_HOST: "127.0.0.1",
        APP_SECRET: "mcp-example-build-spec",
        LOG_LEVEL: "error",
      }),
    });
    const url = `http://127.0.0.1:${port}/mcp`;
    const post = async (body: Record<string, unknown>) => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
          });
          return (await res.json()) as any;
        } catch (error) {
          if (attempt > 50) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    };

    const list = await post({ method: "tools/list", params: {} });
    expect(list.result.tools[0]._meta.ui.resourceUri).toBe(
      "ui://tools/sales_report",
    );

    const read = await post({
      method: "resources/read",
      params: { uri: "ui://tools/sales_report" },
    });
    const content = read.result.contents[0];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toMatch(/^<!doctype html>/);
    expect(content.text).toContain('<div id="root"></div>');
    expect(content.text).toContain('<script type="module">');
    expect(content.text).not.toMatch(/<script[^>]* src=/);
  }, 30_000);
});
