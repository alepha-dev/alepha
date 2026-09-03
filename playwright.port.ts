import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The e2e port for one suite, shared by every Playwright config in the repo.
 *
 * Same reasoning as `vitest.projects.ts`: a setting that must hold across six
 * configs lives in one file, and a caller contributes nothing but its own
 * name.
 *
 * ## The two rules this file exists to enforce
 *
 * **1. An e2e port is never a dev port.** Until this rewrite the two were
 * literally the same number — `apps/docs` served dev on 3302 and ran e2e on
 * 3302, lore on 3303 and 3303, and so on down the band. With
 * `reuseExistingServer` on, `yarn dev` in one terminal and `yarn e2e` in
 * another meant Playwright quietly adopted the DEV server and ran the whole
 * suite against it: hot-reloaded sources instead of `node dist`, the dev
 * database instead of `:memory:`, and a green report either way. The bands are
 * now disjoint, so that particular lie is unreachable:
 *
 * | band          | who owns it                                            |
 * |---------------|--------------------------------------------------------|
 * | 3001-3006     | `apps/benchmark`                                        |
 * | 3300-3399     | dev servers (`dev.port` in each `alepha.config.ts`)      |
 * | 5173+         | dev servers with no `dev.port` (Vite default, multi-app) |
 * | 11883/15432/16379/19090 | `compose.yml` test services                   |
 * | **4300-4999** | **e2e, and nothing else**                               |
 *
 * **2. The port is verified free before it is handed out.** A band of its own
 * stops the repo from colliding with itself; it says nothing about the rest of
 * the machine, or about a stale server left behind by an interrupted run. Every
 * candidate is bind-tested, and a busy one is skipped.
 *
 * ## Why the candidate is derived and not just "the first free port"
 *
 * Probing is not the thing that separates two agents running e2e at once, one
 * git worktree each. `yarn start` builds for a minute or more before it binds,
 * so two runs started in that window both see the same port free and both
 * choose it. What separates them is the checkout hash: different worktrees get
 * different starting bases, far apart, before anyone probes anything.
 *
 * So the derivation stays primary and the probe is the safety net — for a dev
 * server, an unrelated local service, or a stale process holding the slot. When
 * the probe does move, it advances a whole STRIDE so the run lands on another
 * base rather than in a sibling suite's slot.
 *
 * A fully random port would defeat the derivation and make concurrent runs
 * collide by chance instead of never; `E2E_PORT` remains the escape hatch.
 *
 * @param app the suite's key in {@link E2E_SLOTS}.
 */
export const e2ePort = (app: E2eApp): number => {
  // Memoised through the environment, not a module variable, because
  // `apps/examples/playground` calls this from BOTH its config and its `global-setup.ts`
  // and the two must agree. Under the old fixed port they agreed by arithmetic;
  // now the first call binds the answer and the second reads it back. This also
  // reaches the `webServer` child, which inherits `process.env`.
  if (process.env.E2E_PORT) {
    return Number(process.env.E2E_PORT);
  }

  const root = checkoutRoot();
  const candidates = candidatePorts(root, app);
  const port = firstFreePort(candidates) ?? candidates[0];

  if (port !== candidates[0]) {
    // stderr, not stdout: a `--reporter=json` run writes its payload to stdout
    // and this would corrupt it.
    process.stderr.write(
      `[e2e] ${app}: ${candidates[0]} is busy — using ${port}\n`,
    );
  }

  process.env.E2E_PORT = String(port);
  return port;
};

/**
 * A port for ONE Playwright worker of a suite that boots a server per worker.
 *
 * `e2ePort` hands out a single port because a suite normally has a single
 * `webServer`. `apps/lore` does not: each worker boots its own instance on its
 * own in-memory database, which is what lets its specs run `fullyParallel`
 * (see `apps/lore/e2e/_fixtures.ts`).
 *
 * The walk is the same one `candidatePorts` already produces — same slot, so a
 * sibling suite is never encroached on — divided into disjoint subsequences,
 * one per worker. Two workers therefore never evaluate the same port at all,
 * which is what makes their answers independent of whatever is listening.
 *
 * ⚠️ Deliberately NOT memoised through `E2E_PORT`. That variable exists so a
 * config and its `global-setup` agree on one answer; here every worker must get
 * a DIFFERENT answer, so writing it back would hand the whole run one port.
 * `E2E_PORT` still overrides, offset per worker, which keeps the escape hatch
 * usable for a suite that needs several.
 */
export const e2eWorkerPort = (app: E2eApp, workerIndex: number): number => {
  if (process.env.E2E_PORT) {
    return Number(process.env.E2E_PORT) + workerIndex;
  }

  const candidates = candidatePorts(checkoutRoot(), app);

  // Each worker probes a DISJOINT subsequence, never the shared list rotated to
  // a different start. Rotation was the first attempt and is wrong: a worker
  // whose first choice is busy advances onto the next base, which is exactly
  // the base the next worker started from, and both take it. The suite's own
  // test caught it, 14 workers yielding 13 distinct ports, and it would have
  // surfaced in a run as one instance failing to bind for no visible reason.
  //
  // Taking every WORKER_SLOTS-th candidate makes that impossible rather than
  // unlikely: two workers never evaluate the same port at all, so what is
  // listening cannot make their answers converge.
  const slot = workerIndex % WORKER_SLOTS;
  const mine = candidates.filter((_, i) => i % WORKER_SLOTS === slot);

  return firstFreePort(mine) ?? mine[0];
};

/**
 * How many workers get disjoint port sequences.
 *
 * Above this they wrap and workers `w` and `w + WORKER_SLOTS` share a list
 * again. Sixteen is past anything this repo runs: Lore's suite is measured
 * slower at 10 workers than at 7 and fails outright at 14, because the limit is
 * CPU per browser-plus-server pair rather than ports. Raising it costs fallback
 * depth, since the band holds a fixed number of bases to divide up.
 */
const WORKER_SLOTS = 16;

/**
 * The e2e band. Nothing else in the repo may allocate inside it — see the table
 * above for what owns everything around it.
 */
export const E2E_BAND_START = 4300;
export const E2E_BAND_END = 4999;

/**
 * One slot per Playwright config, which is what makes an intra-checkout
 * collision impossible rather than unlikely.
 *
 * The previous scheme derived the slot from the app's dev port (`default % 100`)
 * and so depended on two unrelated numbers staying coordinated by comment. An
 * explicit registry cannot drift: a new suite either appears here or does not
 * typecheck. Slots 6-9 are free; past that, raise {@link STRIDE} and the band.
 */
export const E2E_SLOTS = {
  docs: 0,
  lore: 1,
  playground: 2,
  shop: 3,
  ssr: 4,
  "ssr-dev": 5,
} as const;

export type E2eApp = keyof typeof E2E_SLOTS;

const STRIDE = 10;
const BASES = Math.floor((E2E_BAND_END + 1 - E2E_BAND_START) / STRIDE);

/**
 * Every port this suite would accept, best first: the derived base, then each
 * subsequent base wrapping through the band.
 *
 * Pure, so the whole allocation can be unit-tested without binding a socket.
 */
export const candidatePorts = (root: string, app: E2eApp): number[] => {
  const digest = createHash("sha256").update(root).digest();
  const first = digest.readUInt16BE(0) % BASES;
  return Array.from(
    { length: BASES },
    (_, i) => E2E_BAND_START + ((first + i) % BASES) * STRIDE + E2E_SLOTS[app],
  );
};

/**
 * The first candidate nothing is listening on.
 *
 * A child process because Playwright evaluates a config synchronously and node
 * has no synchronous bind — one spawn scans the whole list rather than one per
 * candidate. Three binds per candidate: the wildcard catches a `node dist`
 * squatter on Linux, but on macOS a wildcard bind SUCCEEDS while something
 * holds `127.0.0.1` (`wrangler dev`), so the loopback addresses are probed
 * too. An address family the host does not have counts as free.
 */
const firstFreePort = (candidates: number[]): number | undefined => {
  const scan = `
const net = require("node:net");
const bindable = (port, host) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) =>
      resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT"),
    );
    server.once("listening", () => server.close(() => resolve(true)));
    host ? server.listen(port, host) : server.listen(port);
  });
const free = async (port) =>
  (await bindable(port)) &&
  (await bindable(port, "127.0.0.1")) &&
  (await bindable(port, "::1"));
(async () => {
  for (const port of process.argv.slice(1)) {
    if (await free(Number(port))) {
      process.stdout.write(port);
      return;
    }
  }
})();
`;

  try {
    const out = execFileSync(
      process.execPath,
      ["-e", scan, "--", ...candidates.map(String)],
      {
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return out ? Number(out) : undefined;
  } catch {
    // Never fail a suite over the probe. Falling back to the derived port is
    // exactly the behaviour this file had before probing existed.
    return undefined;
  }
};

/**
 * The nearest ancestor holding a `.git`, which is the worktree root - a
 * worktree has a `.git` FILE rather than a directory, and `existsSync` does
 * not care which.
 */
const checkoutRoot = (): string => {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
};
