import { Alepha, createMiddleware, t } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, test, vi } from "vitest";
import { $job, jobExecutionEntity } from "../index.ts";

const $track = (log: string[], tag: string) =>
  createMiddleware({
    name: `$track:${tag}`,
    handler:
      ({ next }) =>
      async (...args: any[]) => {
        log.push(`${tag}:before`);
        const result = await next(...args);
        log.push(`${tag}:after`);
        return result;
      },
  });

describe("$job middleware", () => {
  test("should apply middleware to job handler", async () => {
    const log: string[] = [];

    class App {
      repo = $repository(jobExecutionEntity);
      myJob = $job({
        schema: t.object({ value: t.text() }),
        use: [$track(log, "mw")],
        handler: async () => {
          log.push("handler");
        },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    await app.myJob.push({ value: "test" });

    await vi.waitFor(() => {
      expect(log).toStrictEqual(["mw:before", "handler", "mw:after"]);
    });
  });

  test("should compose multiple middleware in order", async () => {
    const log: string[] = [];

    class App {
      repo = $repository(jobExecutionEntity);
      myJob = $job({
        schema: t.object({ value: t.text() }),
        use: [$track(log, "first"), $track(log, "second")],
        handler: async () => {
          log.push("handler");
        },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    await app.myJob.push({ value: "test" });

    await vi.waitFor(() => {
      expect(log).toStrictEqual([
        "first:before",
        "second:before",
        "handler",
        "second:after",
        "first:after",
      ]);
    });
  });

  test("should work without middleware (no wrapping overhead)", async () => {
    const handler = vi.fn();

    class App {
      repo = $repository(jobExecutionEntity);
      myJob = $job({
        schema: t.object({ value: t.text() }),
        handler,
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    await app.myJob.push({ value: "test" });

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    const args = handler.mock.calls[0][0];
    expect(args.items[0].payload).toEqual({ value: "test" });
  });

  test("should apply middleware to cron-triggered jobs", async () => {
    const log: string[] = [];

    class App {
      repo = $repository(jobExecutionEntity);
      cronJob = $job({
        cron: "0 0 * * *",
        use: [$track(log, "mw")],
        handler: async () => {
          log.push("handler");
        },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    await app.cronJob.trigger();

    await vi.waitFor(() => {
      expect(log).toStrictEqual(["mw:before", "handler", "mw:after"]);
    });
  });
});
