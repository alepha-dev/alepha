import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A port band, and the spacing between the bases carved out of it.
 *
 * `stride` is how far apart two consecutive bases sit, so it also caps how
 * many suites one allocator can keep disjoint: a registry with more slots than
 * `stride` would wrap a suite onto its neighbour's port.
 */
export interface E2ePortBand {
  start: number;
  end: number;
  stride: number;
}

/**
 * A band nothing else conventionally allocates from: high enough to clear the
 * 3xxx and 5173+ ranges dev servers use, low enough to stay well under the
 * ephemeral range.
 */
export const DEFAULT_E2E_BAND: E2ePortBand = {
  start: 4300,
  end: 4999,
  stride: 10,
};

/**
 * Hands one suite its port, and exposes the candidate list it would walk.
 */
export interface E2ePortAllocator<S extends Record<string, number>> {
  (app: keyof S): number;

  readonly band: E2ePortBand;

  /**
   * Every port this suite would accept for a given checkout, best first.
   *
   * Pure, so the whole allocation can be unit-tested without binding a socket.
   */
  candidates(root: string, app: keyof S): number[];

  /**
   * The checkout this process runs from: the nearest ancestor of the working
   * directory holding a `.git`, which is the `root` every allocation hashes.
   *
   * Exposed so a test can ask for the same candidate list the allocator walks.
   * `process.cwd()` is only that root when the suite runs from the top of the
   * checkout; a workspace-level run sits below it.
   */
  root(): string;

  /**
   * A port for ONE Playwright worker of a suite that boots a server per
   * worker.
   *
   * The allocator itself hands out a single port, because a suite normally has
   * a single `webServer`. A suite whose workers each boot their own instance
   * (on their own in-memory database, which is what lets its specs run
   * `fullyParallel`) needs one per worker instead.
   *
   * The walk is the same candidate list, so a sibling suite is never
   * encroached on, divided into disjoint subsequences, one per worker. Two
   * workers therefore never evaluate the same port at all, which is what makes
   * their answers independent of whatever is listening.
   *
   * ⚠️ Deliberately NOT memoised through `E2E_PORT`. That variable exists so a
   * config and its global setup agree on one answer; here every worker must
   * get a DIFFERENT answer, so writing it back would hand the whole run one
   * port. `E2E_PORT` still overrides, offset per worker, which keeps the
   * escape hatch usable for a suite that needs several.
   */
  worker(app: keyof S, workerIndex: number): number;
}

/**
 * How many workers get disjoint port sequences.
 *
 * Above this they wrap, and workers `w` and `w + WORKER_SLOTS` share a list
 * again. Sixteen is past what one machine usefully runs: the limit on a
 * browser-plus-server pair per worker is CPU, not ports, and the band holds a
 * fixed number of bases to divide up, so raising this costs fallback depth.
 */
const WORKER_SLOTS = 16;

/**
 * Build an e2e port allocator over a registry of suites.
 *
 * ## The two rules this exists to enforce
 *
 * **1. An e2e port is never a dev port.** The failure it was written for: a
 * suite whose e2e port equalled its dev port. With Playwright's
 * `reuseExistingServer` on, `yarn dev` in one terminal and `yarn e2e` in
 * another meant the suite quietly adopted the DEV server and ran against
 * hot-reloaded sources and the dev database, reporting green either way.
 * Giving e2e a band of its own makes that particular lie unreachable.
 *
 * **2. The port is verified free before it is handed out.** A band of its own
 * stops a repo colliding with itself; it says nothing about the rest of the
 * machine, or about a stale server left by an interrupted run. Every candidate
 * is bind-tested and a busy one is skipped.
 *
 * ## Why the candidate is derived and not just "the first free port"
 *
 * Probing is not what separates two agents running e2e at once, one checkout
 * each. A build takes a minute or more before it binds, so two runs started in
 * that window both see the same port free and both choose it. What separates
 * them is the checkout hash: different checkouts get different starting bases,
 * far apart, before anyone probes anything.
 *
 * So the derivation is primary and the probe is the safety net, for a dev
 * server, an unrelated local service, or a stale process. When the probe does
 * move, it advances a whole `stride` so the run lands on another base rather
 * than in a sibling suite's slot.
 *
 * A fully random port would defeat the derivation and make concurrent runs
 * collide by chance instead of never. `E2E_PORT` remains the escape hatch.
 *
 * @param slots one entry per suite. An explicit registry cannot drift: a new
 *   suite either appears in it or does not typecheck. Keep it in the consuming
 *   repository, since suite names are that repository's business.
 * @param band overrides {@link DEFAULT_E2E_BAND}.
 *
 * @example
 * ```ts
 * export const E2E_SLOTS = { docs: 0, app: 1 } as const;
 * export const e2ePort = createE2ePortAllocator(E2E_SLOTS);
 *
 * // playwright.config.ts
 * const port = e2ePort("docs");
 * ```
 */
export const createE2ePortAllocator = <S extends Record<string, number>>(
  slots: S,
  band: Partial<E2ePortBand> = {},
): E2ePortAllocator<S> => {
  const resolved: E2ePortBand = { ...DEFAULT_E2E_BAND, ...band };
  const bases = Math.floor(
    (resolved.end + 1 - resolved.start) / resolved.stride,
  );

  const candidates = (root: string, app: keyof S): number[] => {
    const digest = createHash("sha256").update(root).digest();
    const first = digest.readUInt16BE(0) % bases;
    return Array.from(
      { length: bases },
      (_, i) =>
        resolved.start +
        ((first + i) % bases) * resolved.stride +
        (slots[app] as number),
    );
  };

  const allocate = (app: keyof S): number => {
    // Memoised through the environment, not a module variable, because a suite
    // may call this from BOTH its config and a global setup file, and the two
    // must agree. The first call binds the answer and the second reads it
    // back. This also reaches the `webServer` child, which inherits
    // `process.env`.
    if (process.env.E2E_PORT) {
      return Number(process.env.E2E_PORT);
    }

    const list = candidates(checkoutRoot(), app);
    const port = firstFreePort(list) ?? list[0];

    if (port !== list[0]) {
      // stderr, not stdout: a `--reporter=json` run writes its payload to
      // stdout and this would corrupt it.
      process.stderr.write(
        `[e2e] ${String(app)}: ${list[0]} is busy, using ${port}\n`,
      );
    }

    process.env.E2E_PORT = String(port);
    return port;
  };

  const worker = (app: keyof S, workerIndex: number): number => {
    if (process.env.E2E_PORT) {
      return Number(process.env.E2E_PORT) + workerIndex;
    }

    // Each worker probes a DISJOINT subsequence, never the shared list rotated
    // to a different start. Rotation was the first attempt and is wrong: a
    // worker whose first choice is busy advances onto the next base, which is
    // exactly the base the next worker started from, and both take it (14
    // workers, 13 distinct ports, one instance failing to bind for no visible
    // reason). Taking every WORKER_SLOTS-th candidate makes that impossible
    // rather than unlikely.
    const slot = workerIndex % WORKER_SLOTS;
    const mine = candidates(checkoutRoot(), app).filter(
      (_, i) => i % WORKER_SLOTS === slot,
    );

    return firstFreePort(mine) ?? mine[0];
  };

  return Object.assign(allocate, {
    band: resolved,
    candidates,
    root: checkoutRoot,
    worker,
  });
};

/**
 * The first candidate nothing is listening on.
 *
 * A child process because Playwright evaluates a config synchronously and node
 * has no synchronous bind. One spawn scans the whole list rather than one per
 * candidate. Three binds per candidate: the wildcard catches a squatter on
 * Linux, but on macOS a wildcard bind SUCCEEDS while something holds
 * `127.0.0.1` (`wrangler dev` does exactly this), so the loopback addresses
 * are probed too. An address family the host does not have counts as free.
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
    // exactly the behaviour this had before probing existed.
    return undefined;
  }
};

/**
 * The checkout the caller is running from.
 *
 * Reads `process.cwd()` rather than this module's own location on purpose:
 * once this code lives inside an installed package, its own path says nothing
 * about which checkout is running the suite. The caller's does, and for a
 * downstream app it resolves that app's own repository.
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

/**
 * Playwright helpers.
 *
 * Collision-free e2e port allocation across concurrent checkouts, which is
 * what lets two agents (or two git worktrees) run the same suite at once
 * without fighting over a socket.
 *
 * ⚠️ Node only. This module spawns a child process and reads the filesystem,
 * so it has no meaning on workerd or in a browser, and deliberately ships no
 * `index.workerd.ts`. It belongs in a Playwright config, never in app code.
 *
 * @module alepha.testing.playwright
 */
