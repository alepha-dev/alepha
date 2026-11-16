import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

/**
 * The renderer's first load across requests, on workerd (#Q3792).
 *
 * Under `handle_cross_request_promise_resolution` a promise belongs to the
 * request that created it. `load()` used to share its in-flight `import()`:
 * when request A started it and ended first (a client gone during a cold
 * start), request B awaited A's promise and failed with "This promise was
 * created by a request that has since ended", which the page then streamed
 * into `#root` (#Q3757, errors 1694 and 1696 on lore/production).
 *
 * The fixture slows the import down through the provider's `importRenderer`
 * seam so A is sure to end before it settles.
 */
describe("ReactDomServerProvider (workerd)", () => {
  it("gives a request the renderer although an earlier, ended request started the first load", async ({
    expect,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-react-dom-server-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/react-dom-server-runtime.ts",
    );
    const provider = join(
      process.cwd(),
      "packages/alepha/src/react/router/providers/ReactDomServerProvider.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { ReactDomServerProvider } from ${JSON.stringify(provider)};
class SlowProvider extends ReactDomServerProvider {
 importRenderer() {
  return new Promise((resolve) => setTimeout(resolve, 300)).then(() =>
   super.importRenderer(),
  );
 }
}
const renderer = new SlowProvider();
export default { async fetch(request) {
 const path = new URL(request.url).pathname;
 if (path === "/start") {
  // Starts the first load and ends before it settles.
  renderer.load().catch(() => {});
  return new Response("started");
 }
 const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 3000));
 try {
  const loaded = await Promise.race([renderer.load(), timeout]);
  if (loaded === "timeout") return new Response("timeout", { status: 504 });
  return new Response(typeof loaded.renderToReadableStream);
 } catch (error) {
  return new Response(String(error?.message ?? error), { status: 500 });
 }
} };
`,
    );
    let runtime: Miniflare | undefined;
    try {
      await build({
        configFile: false,
        publicDir: false,
        logLevel: "silent",
        ssr: {
          noExternal: true,
          resolve: { conditions: ["workerd", "module"] },
        },
        build: {
          ssr: entry,
          outDir: dir,
          emptyOutDir: false,
          minify: false,
          rolldownOptions: {
            external: [/^cloudflare:/, /^node:/],
            output: {
              entryFileNames: "worker.js",
              codeSplitting: false,
              format: "esm",
            },
          },
        },
      });
      const script = await readFile(join(dir, "worker.js"), "utf8");
      runtime = new Miniflare({
        port: 0,
        telemetry: { enabled: false },
        workers: [
          {
            config: {
              name: "react-dom-server-fixture",
              // The build's own date and flags (2026-11-03 since #Q3062).
              compatibilityDate: "2026-11-03",
              compatibilityFlags: ["nodejs_compat"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
            },
          },
        ],
      });

      const started = await runtime.dispatchFetch("http://ssr.test/start");
      expect(await started.text()).toBe("started");

      const render = await runtime.dispatchFetch("http://ssr.test/render");
      const body = await render.text();
      expect(body).not.toContain("since ended");
      expect(render.status).toBe(200);
      expect(body).toBe("function");
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
