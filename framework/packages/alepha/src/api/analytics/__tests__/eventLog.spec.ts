import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import {
  $eventLog,
  EventLogProvider,
  MemoryEventLogProvider,
} from "../index.ts";

class Traffic {
  public readonly pageviews = $eventLog({
    index: "appId",
    schema: z.object({
      appId: z.string(),
      sessionId: z.string(),
      path: z.string().nullable().optional(),
    }),
    keep: "90d",
  });
}

const boot = async <T extends object>(target: new () => T) => {
  const alepha = Alepha.create();
  const app = alepha.inject(target);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  dateTime.pause();
  return { alepha, app, dateTime };
};

describe("$eventLog", () => {
  it("defaults its name to the property key and binds the memory provider under test", async () => {
    const { alepha, app } = await boot(Traffic);
    expect(app.pageviews.eventLog.name).toBe("pageviews");
    expect(alepha.inject(EventLogProvider)).toBeInstanceOf(
      MemoryEventLogProvider,
    );
  });

  it("stores one row per event, placed at now unless the row says when", async () => {
    const { app, dateTime } = await boot(Traffic);
    const now = dateTime.nowMillis();
    await app.pageviews.append([
      { appId: "a", sessionId: "s1", path: "/" },
      { appId: "a", sessionId: "s1", path: "/", at: now - 3_600_000 },
    ]);
    const result = await app.pageviews.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { events: { count: "*" }, visitors: { distinct: "sessionId" } },
      orderBy: { key: "hour", direction: "asc" },
    });
    expect(result.rows).toEqual([
      {
        hour: new Date(now - 3_600_000).toISOString().slice(0, 13),
        events: 1,
        visitors: 1,
      },
      {
        hour: new Date(now).toISOString().slice(0, 13),
        events: 1,
        visitors: 1,
      },
    ]);
    expect(result.estimated).toBe(false);
  });

  it("clamps an event from a clock running ahead, and drops one past keep", async () => {
    const { alepha, app, dateTime } = await boot(Traffic);
    const now = dateTime.nowMillis();
    await app.pageviews.append([
      { appId: "a", sessionId: "ahead", path: "/", at: now + 3_600_000 },
      { appId: "a", sessionId: "old", path: "/", at: now - 91 * 86_400_000 },
      { appId: "a", sessionId: "slight", path: "/", at: now + 60_000 },
    ]);
    const stored = (
      alepha.inject(EventLogProvider) as MemoryEventLogProvider
    ).all(app.pageviews.eventLog);
    expect(stored.map((row) => [row.sessionId, row.at])).toEqual([
      ["ahead", now],
      ["slight", now + 60_000],
    ]);
  });

  it("stores a column the row omits as null", async () => {
    const { alepha, app } = await boot(Traffic);
    await app.pageviews.append([{ appId: "a", sessionId: "s" }]);
    const [stored] = (
      alepha.inject(EventLogProvider) as MemoryEventLogProvider
    ).all(app.pageviews.eventLog);
    expect(stored.path).toBeNull();
  });

  it("refuses a camelCase name, an unknown index, a reserved column and a bad keep at init", async () => {
    const schema = z.object({ appId: z.string() });
    class CamelName {
      public readonly pageViews = $eventLog({
        index: "appId",
        schema,
        keep: "1d",
      });
    }
    class UnknownIndex {
      public readonly views = $eventLog({ index: "nope", schema, keep: "1d" });
    }
    class Reserved {
      public readonly views = $eventLog({
        index: "appId",
        schema: z.object({ appId: z.string(), day: z.string() }),
        keep: "1d",
      });
    }
    class BadKeep {
      public readonly views = $eventLog({
        index: "appId",
        schema,
        keep: "90m",
      });
    }
    expect(() => Alepha.create().inject(CamelName)).toThrow(/snake_case/);
    expect(() => Alepha.create().inject(UnknownIndex)).toThrow(/nope/);
    expect(() => Alepha.create().inject(Reserved)).toThrow(/reserved/);
    expect(() => Alepha.create().inject(BadKeep)).toThrow(/keep/);
  });

  it("refuses an invalid query before it reaches the provider", async () => {
    const { app } = await boot(Traffic);
    await expect(
      app.pageviews.query({ select: { events: { count: "*" } } }),
    ).rejects.toThrow(/since/);
    await expect(
      app.pageviews.query({ since: "2026-11-01", select: {} }),
    ).rejects.toThrow(/selects nothing/);
    await expect(
      app.pageviews.query({
        since: "2026-11-01",
        select: { events: { count: "*" } },
        orderBy: { key: "path", direction: "asc" },
      }),
    ).rejects.toThrow(/orders by/);
  });
});
