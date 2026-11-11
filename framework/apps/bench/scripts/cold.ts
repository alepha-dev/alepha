import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Cold start CPU of an Alepha app on local workerd: how much CPU a fresh
 * Worker spends to load (parse, module top level, service creation), and then
 * on one event (a cron tick, an API fetch, a page fetch).
 *
 *   yarn w bench cold ../../../lore/apps/lore
 *   yarn w bench cold ../../../lore/apps/lore --variant list --variant eager=ALEPHA_EAGER=true
 *   yarn w bench cold ../examples/shop --events api,page --rounds 9
 *   yarn w bench cold ../../../lore/apps/lore --runtimes node,bun
 *
 * Every sample is a fresh `wrangler dev --local` (one workerd), killed after
 * its one event. CPU is read from the workerd child itself (`proc_pid_rusage`
 * on macOS, `/proc/<pid>/schedstat` on Linux), at ready and after the event,
 * and the same reading for an empty Worker is subtracted. Variants run
 * interleaved, round after round, and the low quartile is reported: a busy
 * machine moves one run by tens of ms, and the low quartile is the run the
 * machine least disturbed.
 *
 * A variant is a build and an environment: `name[=dist][,KEY=VALUE...]`, the
 * dist directory relative to the app (default `dist`). With no `--variant`,
 * two are compared: `list` (the build as it is) and `eager`
 * (`ALEPHA_EAGER=true`, every class created at boot). `--build` runs
 * `alepha build --runtime workerd` first.
 *
 * `--runtimes node,bun` measures load only on a Node and a Bun build: the CPU
 * of the server process until it first answers `GET /health`.
 *
 * A local tool, not a CI gate: the differences that matter are 10 to 100 ms,
 * and CI runners are noisier than that.
 */

interface Variant {
  name: string;
  dist: string;
  vars: Record<string, string>;
}

interface Sample {
  load: number;
  event: number;
}

type EventKind = "cron" | "api" | "page";

const EVENTS: Record<EventKind, { path: string; init?: RequestInit }> = {
  // `--test-scheduled` answers this path with a scheduled event.
  cron: { path: "/__scheduled?cron=*/10+*+*+*+*" },
  api: { path: "/api/_links" },
  page: { path: "/", init: { redirect: "manual" } },
};

// -------------------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string): string[] => {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) {
      values.push(args[i + 1]);
    } else if (args[i].startsWith(`--${name}=`)) {
      values.push(args[i].slice(name.length + 3));
    }
  }
  return values;
};
const appArg = args.find(
  (it, i) => !it.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!appArg) {
  console.error(
    "usage: yarn w bench cold <app path> [--variant name[=dist][,K=V]] [--events cron,api,page] [--rounds 7] [--build] [--runtimes node,bun]",
  );
  process.exit(1);
}
const app = isAbsolute(appArg)
  ? appArg
  : resolve(process.env.INIT_CWD ?? process.cwd(), appArg);
const rounds = Number(flag("rounds")[0] ?? 7);
const events = (flag("events")[0] ?? "cron,api,page").split(",") as EventKind[];
const runtimes = flag("runtimes")[0]?.split(",") ?? [];

const parseVariant = (text: string): Variant => {
  const [head, ...pairs] = text.split(",");
  const [name, dist = "dist"] = head.split("=");
  const vars: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    vars[pair.slice(0, at)] = pair.slice(at + 1);
  }
  // `eager=ALEPHA_EAGER=true` reads as a name and one variable: a dist never
  // holds an `=`, a variable always does.
  if (dist.includes("=") || head.split("=").length > 2) {
    const [, key, value] = head.split("=");
    return { name, dist: "dist", vars: { ...vars, [key]: value } };
  }
  return { name, dist, vars };
};

const variants: Variant[] = flag("variant").length
  ? flag("variant").map(parseVariant)
  : [
      { name: "list", dist: "dist", vars: {} },
      { name: "eager", dist: "dist", vars: { ALEPHA_EAGER: "true" } },
    ];

// -------------------------------------------------------------------------------------------------------------------

/**
 * CPU time of one process in milliseconds, user plus system.
 */
const cpuOf = (pid: number): number => {
  if (process.platform === "linux") {
    // Nanoseconds on CPU, at scheduler resolution: `/proc/<pid>/stat`
    // counts in 10 ms ticks, too coarse for a 5 ms difference.
    return (
      Number(
        execFileSync("cat", [`/proc/${pid}/schedstat`])
          .toString()
          .split(" ")[0],
      ) / 1e6
    );
  }
  // macOS: `ps` rounds to 10 ms, so ask libproc for the exact counters.
  const out = execFileSync("python3", [
    "-c",
    [
      "import ctypes,sys",
      "lib=ctypes.CDLL('/usr/lib/libproc.dylib')",
      "class R(ctypes.Structure): _fields_=[('uuid',ctypes.c_uint8*16),('user',ctypes.c_uint64),('system',ctypes.c_uint64)]+[('pad%d'%i,ctypes.c_uint64) for i in range(40)]",
      "r=R()",
      "assert lib.proc_pid_rusage(int(sys.argv[1]),4,ctypes.byref(r))==0",
      "class T(ctypes.Structure): _fields_=[('numer',ctypes.c_uint32),('denom',ctypes.c_uint32)]",
      "t=T(); ctypes.CDLL(None).mach_timebase_info(ctypes.byref(t))",
      "print((r.user+r.system)*t.numer/t.denom/1e6)",
    ].join("\n"),
    String(pid),
  ]);
  return Number(out.toString().trim());
};

const descendants = (pid: number): Array<{ pid: number; command: string }> => {
  const table = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="])
    .toString()
    .trim()
    .split("\n");
  const rows = table.map((line) => {
    const [p, pp, ...rest] = line.trim().split(/\s+/);
    return { pid: Number(p), ppid: Number(pp), command: rest.join(" ") };
  });
  const found: Array<{ pid: number; command: string }> = [];
  const walk = (parent: number) => {
    for (const row of rows) {
      if (row.ppid === parent) {
        found.push(row);
        walk(row.pid);
      }
    }
  };
  walk(pid);
  return found;
};

const freePort = (): Promise<number> =>
  new Promise((ok) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => ok(port));
    });
  });

/**
 * The repository's own wrangler, never one on the PATH: a global one may run an
 * older workerd than the compatibility date the build asks for.
 */
const wrangler = (() => {
  let dir = resolve(import.meta.dirname, "..");
  for (;;) {
    const candidate = join(dir, "node_modules", ".bin", "wrangler");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return "wrangler";
    dir = parent;
  }
})();

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const kill = async (child: ChildProcess) => {
  for (const { pid } of descendants(child.pid!)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  child.kill("SIGKILL");
  await sleep(100);
};

// -------------------------------------------------------------------------------------------------------------------

/**
 * A copy of the dist's wrangler config with a local D1 bound, so the app has a
 * database. The persisted state is shared by every sample of a variant and
 * migrated once, by a warm-up run.
 */
const configFor = async (dist: string): Promise<string> => {
  const source = await readFile(join(dist, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  config.d1_databases ??= [];
  if (
    !config.d1_databases.some((it: { binding: string }) => it.binding === "DB")
  ) {
    config.d1_databases.push({
      binding: "DB",
      database_name: "bench",
      database_id: "bench-local",
    });
  }
  // A bucket, as a deploy binds one for an app holding a `$storage`.
  config.r2_buckets ??= [];
  if (!config.r2_buckets.length) {
    config.r2_buckets.push({ binding: "BENCH_BUCKET", bucket_name: "bench" });
  }
  config.vars = {
    ...config.vars,
    DATABASE_URL: "d1://DB",
    R2_BUCKET_NAME: config.r2_buckets[0].binding,
    // A deploy sets a real one; a production build refuses to start on the
    // built-in default.
    APP_SECRET: "bench-secret-not-for-production-0123456789",
  };
  // The jobs queue, when the app runs `$job`s through one.
  const manifest = JSON.parse(
    await readFile(join(dist, "manifest.json"), "utf8"),
  );
  if (manifest.resources?.hasQueue && !config.queues) {
    config.queues = {
      producers: [{ binding: "JOBS_QUEUE", queue: "bench-jobs" }],
      consumers: [{ queue: "bench-jobs" }],
    };
  }
  // Smart placement and observability ask the account; a local run has none.
  delete config.placement;
  delete config.observability;
  const path = join(dist, "wrangler.bench.jsonc");
  await writeFile(path, JSON.stringify(config, null, 2));
  return path;
};

/**
 * An empty Worker with the same compatibility settings: the control whose CPU
 * is subtracted from every reading.
 */
const controlDist = async (like: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "alepha-cold-control-"));
  const config = JSON.parse(
    (await readFile(join(like, "wrangler.jsonc"), "utf8")).replace(
      /^\s*\/\/.*$/gm,
      "",
    ),
  );
  await writeFile(
    join(dir, "worker.js"),
    'export default { fetch() { return new Response("ok"); }, scheduled() {} };\n',
  );
  await writeFile(
    join(dir, "wrangler.jsonc"),
    JSON.stringify({
      name: "control",
      main: "./worker.js",
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
    }),
  );
  return dir;
};

interface Target {
  dir: string;
  config: string;
  vars: Record<string, string>;
  persist: string;
}

/**
 * One fresh workerd: its CPU at ready, then after one event.
 */
const sample = async (target: Target, kind: EventKind): Promise<Sample> => {
  const port = await freePort();
  const inspector = await freePort();
  const wranglerArgs = [
    "dev",
    "--local",
    "--test-scheduled",
    "--config",
    target.config,
    "--port",
    String(port),
    "--inspector-port",
    String(inspector),
    "--persist-to",
    target.persist,
    "--log-level",
    "warn",
    "--show-interactive-dev-session=false",
  ];
  for (const [key, value] of Object.entries(target.vars)) {
    wranglerArgs.push("--var", `${key}:${value}`);
  }
  const child = spawn(wrangler, wranglerArgs, {
    cwd: target.dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
  });
  let output = "";
  child.stdout!.on("data", (it) => (output += it));
  child.stderr!.on("data", (it) => (output += it));

  try {
    // Ready: the port takes a connection and workerd is up. A TCP connect,
    // not a request, so the Worker handles nothing before the reading.
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(`workerd never became ready:\n${output.slice(-2000)}`);
      }
      const open = await new Promise<boolean>((ok) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          ok(true);
        });
        socket.once("error", () => ok(false));
      });
      if (
        open &&
        descendants(child.pid!).some((it) => /workerd/.test(it.command))
      ) {
        break;
      }
      await sleep(50);
    }
    // Let the load finish: workerd evaluates the Worker as it starts, and
    // the reading must not race the last of it.
    await sleep(1500);
    const workers = descendants(child.pid!).filter(
      (it) =>
        /\bworkerd\b/.test(it.command) && !/\bwrangler\b/.test(it.command),
    );
    if (workers.length === 0) {
      throw new Error("no workerd process found");
    }
    const readAll = () => workers.reduce((sum, it) => sum + cpuOf(it.pid), 0);
    const atReady = readAll();

    const { path, init } = EVENTS[kind];
    const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
    await response.arrayBuffer();
    await sleep(300);
    const afterEvent = readAll();
    if (process.env.COLD_DEBUG) {
      console.log(
        `\n[${kind}] ${response.status}`,
        workers.map(
          (it) =>
            `${it.pid} ${cpuOf(it.pid).toFixed(1)} ${it.command.slice(0, 90)}`,
        ),
        { atReady, afterEvent },
      );
    }
    return { load: atReady, event: afterEvent - atReady };
  } finally {
    await kill(child);
  }
};

/**
 * A sample, retried when its workerd fails to come up: wrangler sometimes
 * restarts it while it starts, and a lost sample is not a measurement.
 */
const measure = async (target: Target, kind: EventKind): Promise<Sample> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sample(target, kind);
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
};

const lowQuartile = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 4)];
};

// -------------------------------------------------------------------------------------------------------------------

/**
 * Load of a Node or a Bun build: CPU of the server process until it first
 * answers `GET /health`.
 */
const loadOfProcess = async (
  runtime: "node" | "bun",
  dist: string,
): Promise<number> => {
  const port = await freePort();
  const data = await mkdtemp(join(tmpdir(), "alepha-cold-data-"));
  const entry = join(dist, `index.${runtime}.js`);
  const child = spawn(runtime, [entry], {
    cwd: app,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      SERVER_PORT: String(port),
      DATABASE_URL: ":memory:",
      DATA_DIR: data,
      APP_SECRET: "bench-secret-not-for-production-0123456789",
      LOG_LEVEL: "error",
    },
  });
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (Date.now() > deadline)
        throw new Error(`${runtime} never answered /health`);
      const ok = await fetch(`http://localhost:${port}/health`).then(
        (it) => it.ok,
        () => false,
      );
      if (ok) break;
      await sleep(20);
    }
    return cpuOf(child.pid!);
  } finally {
    child.kill("SIGKILL");
    await rm(data, { recursive: true, force: true });
  }
};

// -------------------------------------------------------------------------------------------------------------------

const main = async () => {
  if (args.includes("--build")) {
    execFileSync("npx", ["alepha", "build", "--runtime", "workerd"], {
      cwd: app,
      stdio: "inherit",
    });
  }

  if (runtimes.length) {
    // Each build is copied out of the app: a `dist-*` folder left beside its
    // `package.json` reads as a workspace to Yarn and as source to the linter.
    const builds = await mkdtemp(join(tmpdir(), "alepha-cold-builds-"));
    const distOf = (runtime: string) => join(builds, runtime);
    for (const runtime of runtimes as Array<"node" | "bun">) {
      execFileSync("npx", ["alepha", "build", "--runtime", runtime], {
        cwd: app,
        stdio: "inherit",
      });
      await cp(join(app, "dist"), distOf(runtime), { recursive: true });
    }
    const results: Record<string, Record<string, number[]>> = {};
    for (let round = 0; round < rounds; round++) {
      for (const runtime of runtimes as Array<"node" | "bun">) {
        for (const variant of variants) {
          const key = `${runtime} ${variant.name}`;
          const saved = { ...process.env };
          Object.assign(process.env, variant.vars);
          const value = await loadOfProcess(runtime, distOf(runtime));
          process.env = saved;
          ((results[key] ??= {}).load ??= []).push(value);
        }
      }
      process.stdout.write(".");
    }
    await rm(builds, { recursive: true, force: true });
    console.log(
      "\n\nload, CPU ms until the first /health answer (low quartile)",
    );
    for (const [key, { load }] of Object.entries(results)) {
      console.log(
        `  ${key.padEnd(20)} ${lowQuartile(load).toFixed(1).padStart(8)}`,
      );
    }
    return;
  }

  const base = await mkdtemp(join(tmpdir(), "alepha-cold-"));
  const targets = new Map<string, Target>();
  for (const variant of variants) {
    const dir = join(app, variant.dist);
    const persist = join(base, variant.name);
    await mkdir(persist, { recursive: true });
    targets.set(variant.name, {
      dir,
      config: await configFor(dir),
      vars: variant.vars,
      persist,
    });
  }
  const control = await controlDist(join(app, variants[0].dist));
  const controlTarget: Target = {
    dir: control,
    config: join(control, "wrangler.jsonc"),
    vars: {},
    persist: join(base, "control"),
  };

  // Warm-up: one cron and one fetch per variant, which applies the
  // migrations to its persisted D1, so no measured event pays for them.
  process.stdout.write("warming up");
  for (const target of targets.values()) {
    await measure(target, "cron");
    await measure(target, "api");
    process.stdout.write(".");
  }

  const results: Record<string, Record<EventKind, Sample[]>> = {};
  const record = (name: string, kind: EventKind, value: Sample) => {
    ((results[name] ??= {} as Record<EventKind, Sample[]>)[kind] ??= []).push(
      value,
    );
  };
  process.stdout.write("\nmeasuring");
  for (let round = 0; round < rounds; round++) {
    for (const kind of events) {
      record("control", kind, await measure(controlTarget, kind));
      // Interleaved, and in a rotating order, so a slow minute of the
      // machine lands on every variant alike.
      const order = [...variants.keys()].map(
        (i) => variants[(i + round) % variants.length],
      );
      for (const variant of order) {
        record(
          variant.name,
          kind,
          await measure(targets.get(variant.name)!, kind),
        );
      }
    }
    process.stdout.write(".");
  }

  console.log(
    `\n\n${app}\nCPU ms over an empty Worker, low quartile of ${rounds} rounds`,
  );
  console.log(
    `  ${"variant".padEnd(12)} ${"event".padEnd(6)} ${"load".padStart(8)} ${"event".padStart(8)} ${"total".padStart(8)}`,
  );
  for (const kind of events) {
    const controlLoad = lowQuartile(results.control[kind].map((it) => it.load));
    const controlEvent = lowQuartile(
      results.control[kind].map((it) => it.event),
    );
    for (const variant of variants) {
      const rows = results[variant.name][kind];
      const load = lowQuartile(rows.map((it) => it.load)) - controlLoad;
      const event = lowQuartile(rows.map((it) => it.event)) - controlEvent;
      console.log(
        `  ${variant.name.padEnd(12)} ${kind.padEnd(6)} ${load.toFixed(1).padStart(8)} ${event.toFixed(1).padStart(8)} ${(load + event).toFixed(1).padStart(8)}`,
      );
    }
  }
  console.log(
    `  control: load ${lowQuartile(results.control[events[0]].map((it) => it.load)).toFixed(1)} ms`,
  );
  await rm(base, { recursive: true, force: true });
  await rm(control, { recursive: true, force: true });
};

await main();
