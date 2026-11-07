import { $pipeline, Alepha, z } from "alepha";
import { $topic } from "alepha/topic";
import { describe, it } from "vitest";

import { AlephaLock } from "../index.ts";
import { $lock } from "../primitives/$lock.ts";

/**
 * On a serverless runtime (Cloudflare Workers) no Redis client runs, so
 * `$lock` and `$topic` are the memory ones and hold only inside one isolate.
 * Each says so once, on first use, naming what to use instead (#Q3184).
 */
class App {
  locked = $pipeline({
    use: [$lock({ name: "work" })],
    handler: async () => "ok",
  });

  events = $topic({
    name: "app.events",
    schema: { payload: z.object({ n: z.integer() }) },
  });
}

const boot = async (serverless: boolean) => {
  const alepha = Alepha.create({
    env: serverless ? { ALEPHA_SERVERLESS: true } : {},
  }).with(AlephaLock);
  const warnings: string[] = [];
  alepha.events.on("log:entry", (event) => {
    if (event.entry.level === "WARN") warnings.push(event.entry.message);
  });
  const app = alepha.inject(App);
  await alepha.start();
  return { alepha, app, warnings };
};

describe("per-isolate warning on serverless", () => {
  it("$lock warns once, naming $actor", async ({ expect }) => {
    const { app, warnings } = await boot(true);

    await app.locked();
    await app.locked();

    const lockWarnings = warnings.filter((w) => w.startsWith("$lock 'work'"));
    expect(lockWarnings).toHaveLength(1);
    expect(lockWarnings[0]).toMatch(/\$actor/);
  });

  it("$topic warns once on publish, naming $room", async ({ expect }) => {
    const { app, warnings } = await boot(true);

    await app.events.publish({ n: 1 });
    await app.events.publish({ n: 2 });

    const topicWarnings = warnings.filter((w) =>
      w.startsWith("$topic 'app.events'"),
    );
    expect(topicWarnings).toHaveLength(1);
    expect(topicWarnings[0]).toMatch(/\$room/);
  });

  it("says nothing off serverless", async ({ expect }) => {
    const { app, warnings } = await boot(false);

    await app.locked();
    await app.events.publish({ n: 1 });

    expect(
      warnings.filter((w) => w.startsWith("$lock") || w.startsWith("$topic")),
    ).toEqual([]);
  });
});
