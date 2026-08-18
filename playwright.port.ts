import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The e2e port for one app, shared by every Playwright config in the repo.
 *
 * Same reasoning as `vitest.jsdom.ts`: a setting that must hold across five
 * configs lives in one file, and a caller contributes nothing but its own
 * default. Three of the five had already drifted — `apps/playground` and
 * `apps/example-shop` grew an `E2E_PORT` override that `apps/docs`, `apps/example-ssr`
 * and `apps/lore` never got.
 *
 * ## Why a port needs logic at all
 *
 * `reuseExistingServer` is `!process.env.CI`, so **locally a busy port does not
 * fail — Playwright attaches to whatever answers on it**. That is the fast
 * inner loop working as intended when the server is yours. It is a trap when it
 * is not: several agents run these suites at once, one git worktree each, and
 * they all used to land on the same hard-coded port. The later run then tests
 * the other run's `node dist` against a database already holding that run's
 * rows, and reports green. Nothing in the output says which server answered.
 *
 * So the primary checkout keeps its documented port and a **linked worktree**
 * derives its own, which makes the overlap impossible rather than merely
 * unlikely. Ports land in 3400-3899, clear of every hand-allocated port in the
 * 33xx band (docs 3302, lore 3303, playground 3304, shop 3305, example-ssr
 * 3311/3312).
 *
 * ## Why not a random port
 *
 * A fresh port never has a server on it, so `reuseExistingServer` would never
 * hit and every local run would pay the full production build + boot that reuse
 * exists to avoid. The isolation wanted here is between *checkouts*, not
 * between consecutive runs in one checkout — and a derived port stays
 * reproducible, so a failing run can still be re-attached to.
 *
 * Two worktrees can in principle hash to the same port (~0.4% for three
 * worktrees over 500 slots). `E2E_PORT` is the escape hatch, and is also what
 * to reach for against a worktree checked out before this landed, which still
 * carries its old fixed port.
 *
 * @param defaultPort the port this app owns in the primary checkout.
 */
export const e2ePort = (defaultPort: number): number => {
  if (process.env.E2E_PORT) {
    return Number(process.env.E2E_PORT);
  }

  const root = checkoutRoot();
  // `.git` is a directory in the primary checkout and a FILE (holding
  // `gitdir: …`) in a linked worktree — the cheapest way to tell the two apart
  // without shelling out to git from a config file.
  const marker = join(root, ".git");
  if (!existsSync(marker) || !statSync(marker).isFile()) {
    return defaultPort;
  }

  const derived = derivePort(root, defaultPort);

  // stderr, not stdout: a `--reporter=json` run writes its payload to stdout
  // and this would corrupt it.
  process.stderr.write(
    `[e2e] linked worktree — port ${derived} instead of ${defaultPort} (${root})\n`,
  );
  return derived;
};

/**
 * The pure derivation, split from `e2ePort` so it can be unit-tested without
 * the env/filesystem handling.
 *
 * A per-worktree BASE from the root hash plus a per-app OFFSET from the
 * default's last two digits. The offset is what makes an intra-worktree
 * collision impossible rather than unlikely: the previous formula hashed
 * `root:default` into one 500-slot space per app independently, which left
 * each pair a 1-in-500 chance of colliding — and one real worktree drew it
 * (shop 3305 and example-ssr 3312 both derived 3638, so shop's server always
 * held the port when example-ssr's tried to bind, failing `yarn v`
 * deterministically while each suite passed alone).
 *
 * Requires defaults to stay in the 33xx band with unique last-two-digits,
 * which is already the hand-allocation rule above.
 */
export const derivePort = (root: string, defaultPort: number): number => {
  const digest = createHash("sha256").update(root).digest();
  const base = 3400 + (digest.readUInt16BE(0) % 400);
  return base + (defaultPort % 100);
};

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
