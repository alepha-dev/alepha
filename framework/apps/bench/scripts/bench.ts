import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

/**
 * Server CPU per request: the Alepha app against the Express app doing the
 * same job, each endpoint loaded in alternating bursts.
 *
 * Requests per second only measure the machine when other work shares it, so
 * this measures what each server spent: both run side by side, every burst is
 * read as CPU µs per request from the server's own `process.cpuUsage()`, the
 * order flips on every pair, and the verdict is the median of the per-pair
 * ratios. Needs `oha` on the PATH.
 *
 *   yarn bench                                  # every endpoint, 7 pairs
 *   yarn bench --endpoints user,create --pairs 5
 *   yarn bench --runtime bun                    # both servers on Bun
 *
 * `--alepha` and `--express` name other server entries, relative to this
 * workspace: `ssr/` uses them for its page (see ssr/README.md).
 */
const { values: args } = parseArgs({
  options: {
    pairs: { type: "string", default: "7" },
    requests: { type: "string", default: "20000" },
    concurrency: { type: "string", default: "32" },
    endpoints: { type: "string", default: "ping,hello,user,listbr,create" },
    runtime: { type: "string", default: "node" },
    alepha: { type: "string", default: "src/main.ts" },
    express: { type: "string", default: "express/main.js" },
  },
});

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const pairs = Number(args.pairs);
const requests = Number(args.requests);
const work = mkdtempSync(join(tmpdir(), "alepha-bench-"));
const body = join(work, "body.json");
writeFileSync(
  body,
  JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", age: 36 }),
);

const endpoints: Record<string, (base: string) => string[]> = {
  ping: (base) => ["-m", "GET", `${base}/ping`],
  hello: (base) => ["-m", "GET", `${base}/api/hello`],
  user: (base) => ["-m", "GET", `${base}/api/users/42?expand=true`],
  listbr: (base) => [
    "-m",
    "GET",
    "-H",
    "accept-encoding: gzip, deflate, br",
    `${base}/api/users`,
  ],
  create: (base) => [
    "-m",
    "POST",
    "-T",
    "application/json",
    "-D",
    body,
    `${base}/api/users`,
  ],
  // A server-rendered page (ssr/), as a browser asks for it.
  page: (base) => [
    "-m",
    "GET",
    "-H",
    "accept-encoding: gzip, deflate, br",
    `${base}/`,
  ],
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Server {
  name: "express" | "alepha";
  base: string;
  cpuFile: string;
  child: ChildProcess;
}

const start = async (name: Server["name"], entry: string): Promise<Server> => {
  const port = await freePort();
  const cpuFile = join(work, `${name}.cpu`);
  const preload = join(root, "scripts/cpu-preload.ts");
  const runtimeArgs =
    args.runtime === "bun"
      ? ["--preload", preload, entry]
      : ["--import", preload, entry];
  const child = spawn(args.runtime, runtimeArgs, {
    cwd: root,
    env: {
      ...process.env,
      CPU_OUT: cpuFile,
      NODE_ENV: "production",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/ping`);
      return { name, base, cpuFile, child };
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`${name} did not start on ${base}`);
};

const cpu = (server: Server) => Number(readFileSync(server.cpuFile, "utf8"));

const oha = (argv: string[]) =>
  execFileSync(
    "oha",
    ["--no-tui", "-n", String(requests), "-c", args.concurrency, ...argv],
    { stdio: "ignore" },
  );

const burst = async (server: Server, endpoint: string) => {
  await sleep(150);
  const before = cpu(server);
  oha(endpoints[endpoint](server.base));
  await sleep(150);
  return (cpu(server) - before) / requests;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const servers: Server[] = [];
try {
  const express = await start("express", join(root, args.express));
  servers.push(express);
  const alepha = await start("alepha", join(root, args.alepha));
  servers.push(alepha);

  console.log(
    `runtime ${args.runtime}, ${pairs} pairs of ${requests} requests per endpoint`,
  );
  console.log(
    "endpoint   express µs/req   alepha µs/req   alepha vs express   pair ratios",
  );
  for (const endpoint of args.endpoints.split(",")) {
    if (!endpoints[endpoint]) {
      throw new Error(`unknown endpoint ${endpoint}`);
    }
    // Warm-up: JIT, connection pools, the compiled schemas.
    oha(endpoints[endpoint](express.base));
    oha(endpoints[endpoint](alepha.base));

    const e: number[] = [];
    const a: number[] = [];
    for (let i = 0; i < pairs; i++) {
      if (i % 2 === 0) {
        e.push(await burst(express, endpoint));
        a.push(await burst(alepha, endpoint));
      } else {
        a.push(await burst(alepha, endpoint));
        e.push(await burst(express, endpoint));
      }
    }
    const ratios = a.map((value, i) => value / e[i]);
    const ratio = median(ratios);
    const verdict =
      ratio < 1
        ? `${((1 - ratio) * 100).toFixed(0)}% less CPU`
        : `${((ratio - 1) * 100).toFixed(0)}% MORE CPU`;
    console.log(
      `${endpoint.padEnd(9)} ${median(e).toFixed(1).padStart(14)} ${median(a)
        .toFixed(1)
        .padStart(15)}   ${verdict.padEnd(18)} ${ratios
        .map((r) => r.toFixed(2))
        .join(" ")}`,
    );
  }
} finally {
  for (const server of servers) {
    server.child.kill("SIGTERM");
  }
  rmSync(work, { recursive: true, force: true });
}
