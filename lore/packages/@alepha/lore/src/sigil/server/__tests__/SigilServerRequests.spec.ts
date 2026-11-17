import { $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $action, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { REQUEST_BUCKETS } from "../../shared/schemas/sigilRequestBuckets.ts";
import { SigilServerRequests } from "../SigilServerRequests.ts";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

class FakeSink extends SigilSinkProvider {
  public ingested: any[] = [];

  override async ingest(env: any) {
    this.ingested.push(env);
  }
}

class Api {
  protected readonly dateTime = $inject(DateTimeProvider);

  getUser = $action({
    method: "GET",
    path: "/users/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ id: z.text() }),
    },
    handler: async ({ params }) => {
      // 300 ms of "work", on the clock the timer reads.
      await this.dateTime.travel(300);
      return { id: params.id };
    },
  });

  broken = $action({
    method: "GET",
    path: "/broken",
    handler: async () => {
      throw new Error("down");
    },
  });
}

/**
 * Server request timing (#Q3777): each answered request reaches the sink as
 * one folded line under its route PATTERN, method, status class and duration
 * bucket.
 */
describe("SigilServerRequests", () => {
  const boot = async () => {
    const alepha = Alepha.create({
      env: { APP_SECRET: "test-secret", SERVER_PORT: 0 },
    })
      .with({ provide: SigilSinkProvider, use: FakeSink })
      .with(SigilServerRequests)
      .with(Api);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    const sink = alepha.inject(SigilSinkProvider) as FakeSink;
    return { alepha, base, sink };
  };

  it("times a request under its route pattern, never its URL", async () => {
    const { alepha, base, sink } = await boot();
    try {
      const response = await fetch(`${base}/api/users/42?tab=1`);
      expect(response.status).toBe(200);

      const requests = sink.ingested.flatMap((env) => env.requests ?? []);
      expect(requests).toEqual([
        {
          route: expect.stringMatching(/\/users\/:id$/),
          method: "GET",
          status: "2xx",
          // 300 ms lands in the (200, 400] bucket.
          bucket: REQUEST_BUCKETS.indexOf(400),
          count: 1,
        },
      ]);
      expect(JSON.stringify(requests)).not.toContain("42");
    } finally {
      await alepha.stop();
    }
  });

  it("files a failure under 5xx", async () => {
    const { alepha, base, sink } = await boot();
    try {
      await fetch(`${base}/api/broken`);
      const requests = sink.ingested.flatMap((env) => env.requests ?? []);
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe("5xx");
    } finally {
      await alepha.stop();
    }
  });
});

/**
 * The sink folds what it is handed: one line per route, method, status class
 * and bucket, with a count, and only while vitals are collected.
 */
describe("SigilSinkProvider requests", () => {
  const line = {
    route: "/api/users/:id",
    method: "GET",
    status: "2xx" as const,
    bucket: 2,
    count: 1,
  };

  it("folds identical lines into one with a count", async () => {
    const alepha = Alepha.create({ env: { APP_SECRET: "test-secret" } });
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();
    const sent: any[] = [];
    (sink as any).report = (envelope: any) => sent.push(envelope);

    await sink.ingest({ requests: [line, line] });
    await sink.ingest({ requests: [{ ...line, bucket: 3 }] });
    await sink.flush();

    expect(sent.flatMap((env) => env.requests ?? [])).toEqual([
      { ...line, count: 2 },
      { ...line, bucket: 3, count: 1 },
    ]);
    await alepha.stop();
  });
});
