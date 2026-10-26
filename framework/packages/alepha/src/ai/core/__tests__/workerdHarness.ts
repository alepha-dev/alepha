import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";

/**
 * Bundle `source` for workerd (the `workerd` export conditions, as
 * `alepha build` does) and run it in Miniflare under the build's own
 * compatibility date, then hand `use` a fetch into the worker.
 *
 * Shared by the AI vendor providers' workerd specs, which all prove the same
 * thing: the provider's real code path (fetch, ReadableStream, the SSE
 * reader) runs on workerd.
 */
export const withWorkerd = async <T>(
  options: {
    name: string;
    source: string;
    /**
     * Extra worker config (bindings under `env`), merged into Miniflare's.
     */
    config?: Record<string, unknown>;
    /**
     * Runs once Miniflare is up, before `run`: seed a D1 database, say.
     */
    setup?: (runtime: Miniflare) => Promise<void>;
  },
  run: (
    dispatch: (
      body: unknown,
      init?: RequestInit & { path?: string },
    ) => Promise<Response>,
  ) => Promise<T>,
): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), `alepha-${options.name}-`));
  const entry = join(
    process.cwd(),
    `node_modules/.alepha/${options.name}-runtime.ts`,
  );
  await mkdir(join(process.cwd(), "node_modules/.alepha"), { recursive: true });
  await writeFile(entry, options.source);
  let runtime: Miniflare | undefined;
  try {
    await build({
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [
        {
          // The ORM's Bun driver imports `bun:sqlite` behind a runtime check;
          // workerd refuses to load a module naming one it lacks, so the
          // bundle gets an empty stand-in (never called on workerd).
          name: "stub-bun-modules",
          enforce: "pre",
          resolveId: (id: string) => (id.startsWith("bun:") ? `\0${id}` : null),
          load: (id: string) =>
            id.startsWith("\0bun:")
              ? "export const Database = undefined; export default {};"
              : null,
        },
      ],
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
            name: options.name,
            // The date and flags `alepha build` writes. A newer date once
            // hid a Durable Object RPC bug, so the specs pin the build's.
            compatibilityDate: "2025-11-17",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "worker.js",
              modules: { "worker.js": { type: "esm", contents: script } },
            },
            ...options.config,
          },
        },
      ] as any,
    });
    const mf = runtime;
    await options.setup?.(mf);
    return await run((body, init = {}) => {
      const { path = "/", ...rest } = init;
      return mf.dispatchFetch(`http://ai.test${path}`, {
        method: "POST",
        ...rest,
        body: JSON.stringify(body),
      } as any) as unknown as Promise<Response>;
    });
  } finally {
    await runtime?.dispose();
    await rm(dir, { recursive: true, force: true });
    await rm(entry, { force: true });
  }
};

/**
 * A local HTTP server standing in for a vendor: each request is answered by
 * `reply`, and recorded with its parsed JSON body.
 */
export const withUpstream = async <T>(
  reply: (
    req: IncomingMessage,
    body: any,
  ) => { status?: number; headers?: Record<string, string>; body: string },
  run: (
    url: string,
    seen: Array<{
      url: string;
      headers: IncomingMessage["headers"];
      body: any;
    }>,
  ) => Promise<T>,
): Promise<T> => {
  const seen: Array<{
    url: string;
    headers: IncomingMessage["headers"];
    body: any;
  }> = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      const out = reply(req, body);
      res.writeHead(
        out.status ?? 200,
        out.headers ?? { "content-type": "text/event-stream" },
      );
      res.end(out.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
