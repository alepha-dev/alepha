import { randomUUID } from "node:crypto";

import { $inject, $pipeline, Alepha, type Service } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  $lock,
  AlephaLock,
  LockAcquireError,
  LockProvider,
  MemoryLockProvider,
} from "alepha/lock";
import { expect } from "vitest";

export const store: Record<string, string> = {};
export class SharedLockProvider extends MemoryLockProvider {
  store: Record<string, string> = store;
}

export const testLockBasic = async (
  provider: Service<LockProvider>,
): Promise<void> => {
  const state: Record<string, string> = {};
  const lockName = `test-lock-basic-${randomUUID()}`;
  class TestLock {
    lock = $inject(LockProvider);
    dt = $inject(DateTimeProvider);
    stack = () => state.stack;
    migrate = $pipeline({
      use: [$lock({ name: lockName })],
      handler: async () => {
        await this.dt.wait([50, "milliseconds"]);
        state.stack = state.stack ? `${state.stack}A` : "A";
      },
    });
  }

  const prefix = randomUUID();

  const createApp = async () => {
    // One namespace per run: on Redis the provider keys every lock with it.
    return Alepha.create({ env: { APP_NAME: prefix } })
      .with({
        provide: LockProvider,
        use: provider,
      })
      .with(AlephaLock)
      .with(TestLock)
      .start()
      .then((a) => a.inject(TestLock));
  };

  const app1 = await createApp();
  const app2 = await createApp();
  const app3 = await createApp();

  const results = await Promise.allSettled([
    app1.migrate(),
    app2.migrate(),
    app3.migrate(),
  ]);

  // One caller enters, the two others are refused rather than queued.
  expect(results.filter((it) => it.status === "fulfilled")).toHaveLength(1);
  for (const result of results.filter((it) => it.status === "rejected")) {
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
      LockAcquireError,
    );
  }
  expect(app1.stack()).toBe("A");
};

export const testDelIfOwner = async (
  provider: Service<LockProvider>,
): Promise<void> => {
  const alepha = Alepha.create()
    .with({ provide: LockProvider, use: provider })
    .with(AlephaLock);
  const lock = alepha.inject(LockProvider);
  await alepha.start();

  const key = `del-if-owner-${randomUUID()}`;
  await lock.set(key, "owner-1,2026-01-01T00:00:00Z", true, 30_000);

  // Wrong owner: must be a no-op — a holder whose lock already expired must
  // not delete the next holder's lock.
  await lock.delIfOwner(key, "owner-2");
  expect(await lock.get(key)).toContain("owner-1");

  // Right owner: deletes.
  await lock.delIfOwner(key, "owner-1");
  expect(await lock.get(key)).toBeUndefined();
};

export const testLockWait = async (
  provider: Service<LockProvider>,
): Promise<void> => {
  let count = 0;

  // One key per invocation, shared by the three apps below, so a run killed
  // mid-handler cannot leave a lock behind in the shared redis container.
  const lockName = `test-lock-wait-${randomUUID()}`;

  class TestLockWait {
    dt = $inject(DateTimeProvider);

    migrateLock = $pipeline({
      use: [$lock({ name: lockName, wait: true })],
      handler: async () => {
        count++;
        await this.dt.wait([500, "milliseconds"]);
      },
    });

    async migrate() {
      const now = Date.now();
      await this.migrateLock();
      return Date.now() - now;
    }
  }

  const createApp = async () => {
    const app = Alepha.create().with({
      provide: LockProvider,
      use: provider,
    });
    app.with(TestLockWait);
    return app.start().then(() => app.inject(TestLockWait));
  };

  const app1 = await createApp();
  const app2 = await createApp();
  const app3 = await createApp();

  const result = await Promise.all([
    app1.migrate(),
    app2.migrate(),
    app3.migrate(),
  ]);

  expect(result[0]).toBeGreaterThanOrEqual(500);
  expect(result[1]).toBeGreaterThanOrEqual(500);
  expect(result[2]).toBeGreaterThanOrEqual(500);

  // All 3 apps should eventually execute (wait: true means queue, not skip)
  expect(count).toBe(3);
};
