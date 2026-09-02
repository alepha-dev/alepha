import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * How many slots the shared test services are partitioned into.
 *
 * 16 because Redis is the tightest of them: a stock server has databases 0-15
 * and no more, so anything above this would have to fold two checkouts onto
 * one database and the partition would silently stop partitioning.
 */
export const TEST_SLOTS = 16;

/**
 * This checkout's slice of the shared test services, `0` to `TEST_SLOTS - 1`.
 *
 * ## Why the checkout, and not the process
 *
 * The problem is two agents running `yarn v` in two git worktrees at once.
 * `compose.yml` gives the machine ONE postgres, ONE redis, ONE s3mock and ONE
 * emqx, and the two runs have to share them without seeing each other's data.
 *
 * Two of the four already solve it one level down, and neither needs this:
 * postgres builds a `test_alepha_{epoch}_{rand8}` schema per run, and the mqtt
 * specs namespace their topics with a `randomUUID()`. The other two do not -
 * redis had one fixed `queue` prefix on database 0, and s3mock one hardcoded
 * `alepha-test` bucket that the S3 specs `emptyBuckets()` on the way out. So
 * two runs did collide, and the machine-wide `alepha:test` slot was what kept
 * them apart: by making them take turns.
 *
 * Deriving from the checkout PATH rather than the pid is what makes the answer
 * stable across the several processes one run spawns (`yarn test`,
 * `yarn test:bun`, and the vitest workers under each), which is the property a
 * per-process id would not have.
 *
 * ## Why this is not a probe
 *
 * Same reasoning as `playwright.port.ts`, which derives its port base the same
 * way and for the same reason: a probe cannot separate two runs that start
 * inside each other's setup window, and by the time one of them has written a
 * key the other has already chosen the same one. A derivation has no window.
 *
 * Two checkouts CAN hash to one slot - 16 slots and a hash, so it is the
 * birthday problem - and that is the accepted floor. It costs the collision
 * what the queue used to cost everybody.
 *
 * `TEST_SLOT` overrides it, which is the escape hatch when a collision does
 * happen and the one CI needs if it ever runs two checkouts on a runner.
 */
export const testSlot = (): number => {
  const override = process.env.TEST_SLOT;
  if (override !== undefined && override !== "") {
    const parsed = Number(override);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < TEST_SLOTS) {
      return parsed;
    }
  }
  return slotOf(checkoutRoot());
};

/**
 * The slot a given checkout path maps to. Pure, so the derivation can be
 * tested without a filesystem.
 */
export const slotOf = (root: string): number =>
  createHash("sha256").update(root).digest().readUInt16BE(0) % TEST_SLOTS;

/**
 * The nearest ancestor holding a `.git`, which is the worktree root - a
 * worktree has a `.git` FILE rather than a directory, and `existsSync` does
 * not care which.
 */
export const checkoutRoot = (): string => {
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
 * The shared-service settings for this checkout's slot.
 *
 * One function rather than two constants because the two have to agree about
 * the slot: a bucket from one derivation and a database index from another is
 * a partition with a seam in it.
 */
export const testServiceEnv = (): {
  S3_BUCKET_NAME: string;
  REDIS_URL: string;
} => {
  const slot = testSlot();
  return {
    // The S3 specs provision this bucket themselves and empty it on the way
    // out, so a per-slot name is what stops one run's teardown deleting
    // another's objects mid-assertion.
    S3_BUCKET_NAME: `alepha-test-${slot}`,
    // node-redis reads the database index from the URL path, and
    // `NodeRedisProvider` hands the URL straight to `createClient`. One
    // checkout does land on database 0, which is where every run used to
    // sit - so this is no worse for that one and better for the rest.
    REDIS_URL: `redis://localhost:16379/${slot}`,
  };
};
