import { $inject, Alepha, AlephaError, z } from "alepha";
import { $logger } from "alepha/logger";
import { $tool, AlephaMcp, McpServerProvider } from "alepha/mcp";
import { $action, ServerProvider } from "alepha/server";
import { ServerLinksProvider } from "alepha/server/links";
import { describe, expect, it } from "vitest";

import { SigilServerErrors } from "../SigilServerErrors.ts";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

class FakeSink extends SigilSinkProvider {
  public ingested: any[] = [];

  override async ingest(env: any) {
    this.ingested.push(env);
  }
}

const make = () =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
    },
  }).with({ provide: SigilSinkProvider, use: FakeSink });

const emitError = (alepha: Alepha, error: unknown) =>
  alepha.events.emit("server:onError", {
    route: { path: "/x" },
    request: {},
    error,
  } as any);

describe("SigilServerErrors", () => {
  it("tags a server crash as server-origin", async () => {
    const alepha = make();
    alepha.inject(SigilServerErrors);
    await alepha.start();

    await emitError(
      alepha,
      Object.assign(new Error("boom"), { name: "TypeError" }),
    );

    const sink = alepha.inject(SigilSinkProvider) as FakeSink;
    expect(sink.ingested[0].errors[0].name).toBe("TypeError");
    expect(sink.ingested[0].errors[0].origin).toBe("server");
    expect(sink.ingested[0].errors[0].sourceUrl).toBe("/x");
  });

  it("ignores 401 and 403, which are outcomes rather than crashes", async () => {
    const alepha = make();
    alepha.inject(SigilServerErrors);
    await alepha.start();

    // A logged-out visitor and an under-privileged one are routine traffic.
    // Reporting them buries the real errors under noise.
    await emitError(alepha, Object.assign(new Error("nope"), { status: 401 }));
    await emitError(alepha, Object.assign(new Error("nope"), { status: 403 }));

    expect(
      (alepha.inject(SigilSinkProvider) as FakeSink).ingested,
    ).toHaveLength(0);
  });

  it("still reports a 500", async () => {
    const alepha = make();
    alepha.inject(SigilServerErrors);
    await alepha.start();

    await emitError(
      alepha,
      Object.assign(new Error("db down"), { status: 500 }),
    );

    expect(
      (alepha.inject(SigilSinkProvider) as FakeSink).ingested,
    ).toHaveLength(1);
  });
});

describe("SigilServerErrors — what counts as a crash", () => {
  /*
    Every 4xx is the app working: bad input, a path that does not exist, a
    logged-out visitor, a conflict the caller has to resolve. On anything
    reachable from the internet they arrive constantly — a scanner alone
    produces hundreds of 404s a day — and a crash inbox listing them is an
    inbox nobody opens, which costs the 5xx sitting underneath it.
  */
  const statuses = [400, 401, 403, 404, 409, 422, 429, 499];

  for (const status of statuses) {
    it(`should not report a ${status}`, async () => {
      const alepha = make();
      alepha.inject(SigilServerErrors);
      await alepha.start();

      await emitError(alepha, Object.assign(new Error("refused"), { status }));

      expect(alepha.inject(SigilSinkProvider) as FakeSink).toMatchObject({
        ingested: [],
      });
    });
  }

  it("should report a 500", async () => {
    const alepha = make();
    alepha.inject(SigilServerErrors);
    await alepha.start();

    await emitError(alepha, Object.assign(new Error("boom"), { status: 500 }));

    const sink = alepha.inject(SigilSinkProvider) as FakeSink;
    expect(sink.ingested).toHaveLength(1);
  });

  it("should report an error with no status at all", async () => {
    // No status means it never reached the point of becoming a response,
    // which is the definition of a crash.
    const alepha = make();
    alepha.inject(SigilServerErrors);
    await alepha.start();

    await emitError(alepha, new Error("uncaught"));

    const sink = alepha.inject(SigilSinkProvider) as FakeSink;
    expect(sink.ingested).toHaveLength(1);
  });
});

describe("SigilServerErrors — background jobs", () => {
  it("should report a job that threw", async () => {
    /*
      Worth reporting for a reason requests are not: nobody is watching. A
      failed request produces a bad response somebody notices; a cron failing
      every night for a week produces silence, and the first sign is the work
      not having been done.
    */
    const alepha = make();
    alepha.inject(SigilServerErrors);
    await alepha.start();

    await alepha.events.emit("job:error", {
      name: "lore:blights:purge",
      error: new Error("D1 unreachable"),
      executionId: "exec-1",
    } as any);

    const sink = alepha.inject(SigilSinkProvider) as FakeSink;
    expect(sink.ingested).toHaveLength(1);
    // The job name is the source: a stack from a cron says nothing about which
    // cron, and that is the first thing anyone needs.
    expect(sink.ingested[0].errors[0]).toMatchObject({
      sourceUrl: "job:lore:blights:purge",
      origin: "server",
      message: "D1 unreachable",
    });
  });
});

describe("SigilServerErrors — batched actions", () => {
  it("should report an action that failed inside /api/_batch", async () => {
    /*
      ⚠️ Regression guard for a production blind spot (2026-08-11). The batch
      endpoint answers 200 with a per-entry error, so for as long as it kept
      its sub-request failures to itself, `server:onError` never fired for
      them and this class never saw them. That is the path the React client
      uses by default: on a client-rendered app every API failure went
      unreported, and Lore's own crash inbox stayed empty through an outage in
      which every analytics read was 500ing.

      Driven over real HTTP rather than by emitting the event, because the
      whole defect lived in the wiring between the two — each half was
      individually fine.
    */
    class App {
      boom = $action({
        schema: { response: z.text() },
        handler: () => {
          throw new AlephaError("db down");
        },
      });
    }

    const alepha = make().with(App).with(ServerLinksProvider);
    alepha.inject(SigilServerErrors);
    await alepha.start();

    try {
      await fetch(`${alepha.inject(ServerProvider).hostname}/api/_batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ action: "boom" }]),
      });

      const sink = alepha.inject(SigilSinkProvider) as FakeSink;
      expect(sink.ingested).toHaveLength(1);
      expect(sink.ingested[0].errors[0]).toMatchObject({
        sourceUrl: "/api/boom",
        origin: "server",
        message: "db down",
      });
    } finally {
      await alepha.stop();
    }
  });
});

describe("SigilServerErrors — error-level logs", () => {
  class Worker {
    protected readonly log = $logger();

    public swallow(error: Error) {
      this.log.error("best-effort step failed", error);
    }

    public swallowNested(error: Error) {
      this.log.error("best-effort step failed", { error, step: "links" });
    }

    public warn() {
      this.log.warn("expected condition");
    }

    public plain() {
      this.log.error("something is off");
    }
  }

  const setup = async () => {
    const alepha = make();
    alepha.inject(SigilServerErrors);
    const worker = alepha.inject(Worker);
    await alepha.start();
    const sink = alepha.inject(SigilSinkProvider) as FakeSink;
    const errors = () => sink.ingested.flatMap((it) => it.errors);
    return { alepha, sink, errors, worker };
  };

  it("records one blight for a caught-and-logged error, with its stack", async () => {
    const { errors, worker } = await setup();
    const error = Object.assign(new Error("links sync failed"), {
      name: "DbError",
    });

    worker.swallow(error);

    await expect.poll(() => errors().length).toBe(1);
    expect(errors()[0]).toMatchObject({
      name: "DbError",
      message: "links sync failed",
      origin: "server",
    });
    expect(errors()[0].sourceUrl).toMatch(/^log:/);
    expect(errors()[0].stack).toContain("links sync failed");
  });

  it("reads the Error from data.error, and the message alone when there is none", async () => {
    const { errors, worker } = await setup();

    worker.swallowNested(new Error("nested"));
    worker.plain();

    await expect.poll(() => errors().length).toBe(2);
    expect(
      errors()
        .map((it) => String(it.message))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["nested", "something is off"]);
  });

  it("ignores warnings", async () => {
    const { errors, worker } = await setup();

    worker.warn();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errors()).toHaveLength(0);
  });

  it("records a 5xx once, whether the request hook or its log line comes first", async () => {
    const { alepha, errors, worker } = await setup();
    const first = new Error("db down");
    const second = new Error("db down again");

    await emitError(alepha, first);
    worker.swallow(first);
    worker.swallow(second);
    await emitError(alepha, second);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errors()).toHaveLength(2);
  });

  it("does not feed back an error logged while ingesting", async () => {
    class LoopingSink extends FakeSink {
      public readonly worker = $inject(Worker);
      override async ingest(env: any) {
        this.ingested.push(env);
        this.worker.plain();
      }
    }
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    }).with({ provide: SigilSinkProvider, use: LoopingSink });
    alepha.inject(SigilServerErrors);
    await alepha.start();
    const sink = alepha.inject(SigilSinkProvider) as LoopingSink;

    sink.worker.swallow(new Error("first"));

    await expect.poll(() => sink.ingested.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sink.ingested).toHaveLength(1);
  });

  it("records one blight for a failing MCP tool", async () => {
    const alepha = make().with(AlephaMcp);
    class Tools {
      failing = $tool({
        description: "Failing tool",
        handler: async () => {
          throw new Error("tool blew up");
        },
      });
    }
    alepha.with(Tools);
    alepha.inject(SigilServerErrors);
    await alepha.start();
    const sink = alepha.inject(SigilSinkProvider) as FakeSink;

    await alepha.inject(McpServerProvider).handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "failing", arguments: {} },
    });

    await expect.poll(() => sink.ingested.length).toBe(1);
    expect(sink.ingested[0].errors[0].message).toBe("tool blew up");
  });
});
