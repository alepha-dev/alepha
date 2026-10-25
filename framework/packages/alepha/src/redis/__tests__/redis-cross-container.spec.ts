import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { AlephaLock, LockProvider } from "alepha/lock";
import { AlephaQueue, QueueProvider } from "alepha/queue";
import { $topic, AlephaTopic } from "alepha/topic";
import { describe, expect, it } from "vitest";

/**
 * Several instances sharing one Redis, which is what `REDIS_URL` is for: a
 * lock one holds, the others cannot take; a message one publishes, every
 * subscriber gets; a job one pushes, exactly one consumer pops. Against the
 * compose Redis (16379, CI's port too). Each container gets the same
 * `APP_NAME`, so they share one namespace, as the replicas of one app do.
 */
process.env.REDIS_URL ??= "redis://localhost:16379";

const containers = async (count: number, ...modules: any[]) => {
  const name = `cross-${randomUUID()}`;
  return Promise.all(
    Array.from({ length: count }, async () => {
      let alepha = Alepha.create({
        env: { REDIS_URL: process.env.REDIS_URL, APP_NAME: name },
      });
      for (const module of modules) {
        alepha = alepha.with(module);
      }
      await alepha.start();
      return alepha;
    }),
  );
};

describe("Redis across containers", () => {
  it("lets one container hold a lock key, and no other take it while held", async () => {
    const apps = await containers(2, AlephaLock);
    const key = `lock-${randomUUID()}`;
    const locks = apps.map((app) => app.inject(LockProvider));

    // Ten contenders, five per container, all at once.
    const contenders = Array.from({ length: 10 }, (_, i) => ({
      lock: locks[i % 2],
      value: `owner-${i},meta`,
    }));
    const answers = await Promise.all(
      contenders.map((it) => it.lock.set(key, it.value, true, 10_000)),
    );

    const winners = contenders.filter((it, i) => answers[i] === it.value);
    expect(winners).toHaveLength(1);
    expect(await locks[0].get(key)).toBe(winners[0].value);
    expect(await locks[1].get(key)).toBe(winners[0].value);

    await Promise.all(apps.map((app) => app.stop()));
  });

  it("releases a lock only for its owner, from any container", async () => {
    const apps = await containers(2, AlephaLock);
    const key = `lock-${randomUUID()}`;
    const [mine, theirs] = apps.map((app) => app.inject(LockProvider));
    await mine.set(key, "owner-a,meta", true, 10_000);

    expect(await theirs.delIfOwner(key, "owner-b")).toBe(false);
    expect(await mine.get(key)).toBe("owner-a,meta");
    expect(await theirs.delIfOwner(key, "owner-a")).toBe(true);
    expect(await mine.get(key)).toBeUndefined();

    await Promise.all(apps.map((app) => app.stop()));
  });

  it("fans one published message out to the subscribers of every container", async () => {
    const topicName = `fanout-${randomUUID()}`;
    class Topics {
      t = $topic({
        name: topicName,
        schema: { payload: z.object({ value: z.text() }) },
      });
    }
    const apps = await containers(3, AlephaTopic, Topics);
    const received: Array<{ container: number; value: string }> = [];
    for (const [container, app] of apps.slice(1).entries()) {
      await app.inject(Topics).t.subscribe(async (message) => {
        received.push({
          container: container + 1,
          value: message.payload.value,
        });
      });
    }

    await apps[0].inject(Topics).t.publish({ value: "to everyone" });

    await expect
      .poll(() => [...received].sort((a, b) => a.container - b.container))
      .toEqual([
        { container: 1, value: "to everyone" },
        { container: 2, value: "to everyone" },
      ]);

    await Promise.all(apps.map((app) => app.stop()));
  });

  /**
   * The queue is a Redis LIST popped with RPOP: at most once, with no ack
   * and no redelivery of its own. A job that dies after its pop is recovered
   * by `alepha/api/jobs`, whose sweep re-dispatches from the database row
   * (see `$job-lease-recovery.spec.ts`), not by the queue. What the queue
   * guarantees across consumers is this: one push, one pop.
   */
  it("hands each pushed job to exactly one of several competing consumers", async () => {
    const apps = await containers(3, AlephaQueue);
    const queue = `jobs-${randomUUID()}`;
    const [producer, ...consumers] = apps.map((app) =>
      app.inject(QueueProvider),
    );

    const pushed = Array.from({ length: 20 }, (_, i) => `job-${i}`);
    for (const job of pushed) {
      await producer.push(queue, job);
    }

    const popped: string[] = [];
    await Promise.all(
      consumers.map(async (consumer) => {
        for (;;) {
          const job = await consumer.pop(queue);
          if (job === undefined) return;
          popped.push(job);
        }
      }),
    );

    expect([...popped].sort()).toEqual([...pushed].sort());
    expect(new Set(popped).size).toBe(pushed.length);
    expect(await consumers[0].pop(queue)).toBeUndefined();

    await Promise.all(apps.map((app) => app.stop()));
  });
});
