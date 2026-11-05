import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";

/**
 * The same requests asked of the app on Node, on Bun and on workerd
 * (Miniflare), and their answers compared: a change to the request path is
 * meant to change none of them.
 *
 * What legitimately differs is left out of the comparison: the request id
 * (random), and on workerd the compression headers and `content-length`
 * (Cloudflare's edge compresses, and Miniflare's proxy re-frames the body).
 * Every other header, status and body must match. Exits 1 on a difference.
 *
 *   yarn smoke
 */
const root = join(dirname(new URL(import.meta.url).pathname), "..");

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const cases: Array<[string, string, RequestInit?]> = [
  ["ping", "/ping"],
  ["hello", "/api/hello"],
  ["user", "/api/users/42?expand=true"],
  ["user-noexpand", "/api/users/7"],
  ["user-bad-id", "/api/users/abc"],
  ["list-br", "/api/users", { headers: { "accept-encoding": "br" } }],
  ["list-gzip", "/api/users", { headers: { "accept-encoding": "gzip" } }],
  [
    "list-identity",
    "/api/users",
    { headers: { "accept-encoding": "identity" } },
  ],
  ["create", "/api/users", json({ name: "  Ada  ", email: "a@b.c", age: 36 })],
  ["create-missing", "/api/users", json({ name: "Ada" })],
  [
    "create-too-long",
    "/api/users",
    json({ name: "x".repeat(300), email: "a@b.c", age: 1 }),
  ],
  [
    "create-urlencoded",
    "/api/users",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Ada&email=a%40b.c&age=3",
    },
  ],
  [
    "create-big",
    "/api/users",
    json({ name: "Ada", email: "a@b.c", age: 3, pad: "y".repeat(2_000_000) }),
  ],
  ["head-hello", "/api/hello", { method: "HEAD" }],
  ["request-id", "/api/hello", { headers: { "x-request-id": "abc-123" } }],
];

const compared = [
  "content-type",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "strict-transport-security",
];

const ask = async (fetcher: Fetch): Promise<string[]> => {
  const lines: string[] = [];
  for (const [name, path, init] of cases) {
    const res = await fetcher(path, init);
    const headers = Object.fromEntries(
      compared
        .filter((k) => res.headers.has(k))
        .map((k) => [k, res.headers.get(k)]),
    );
    // The request id is random: everything else in an error body must match.
    const body = (await res.text()).replace(
      /"requestId":"[^"]+"/g,
      '"requestId":"…"',
    );
    lines.push(JSON.stringify({ name, status: res.status, headers, body }));
  }
  return lines;
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
  });

const serve = async (runtime: "node" | "bun") => {
  const port = await freePort();
  const child: ChildProcess = spawn(runtime, [join(root, "src/main.ts")], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(port),
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/ping`);
      return {
        child,
        fetcher: ((path, init) => fetch(base + path, init)) as Fetch,
      };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error(`${runtime} did not start`);
};

const onWorkerd = async () => {
  const dir = await mkdtemp(join(tmpdir(), "alepha-smoke-"));
  await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    ssr: { noExternal: true, resolve: { conditions: ["workerd", "module"] } },
    build: {
      ssr: join(root, "src/worker.ts"),
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
  const mf = new Miniflare({
    port: 0,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "bench",
          compatibilityDate: "2026-10-08",
          compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
          manifest: {
            mainModule: "worker.js",
            modules: { "worker.js": { type: "esm", contents: script } },
          },
        },
      },
    ],
  } as any);
  try {
    return await ask(((path: string, init?: RequestInit) =>
      mf.dispatchFetch(
        `http://bench.test${path}`,
        init as any,
      )) as unknown as Fetch);
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
};

const results: Record<string, string[]> = {};
for (const runtime of ["node", "bun"] as const) {
  const { child, fetcher } = await serve(runtime);
  try {
    results[runtime] = await ask(fetcher);
  } finally {
    child.kill("SIGTERM");
  }
}
results.workerd = await onWorkerd();

let failed = false;
for (const runtime of ["bun", "workerd"]) {
  results[runtime].forEach((line, i) => {
    if (line !== results.node[i]) {
      failed = true;
      console.log(`${runtime} differs from node on ${cases[i][0]}:`);
      console.log(`  node:     ${results.node[i].slice(0, 300)}`);
      console.log(`  ${runtime.padEnd(8)}: ${line.slice(0, 300)}`);
    }
  });
}
console.log(
  failed
    ? "smoke: the runtimes disagree"
    : `smoke: ${cases.length} requests answered alike on node, bun and workerd`,
);
process.exit(failed ? 1 : 0);
