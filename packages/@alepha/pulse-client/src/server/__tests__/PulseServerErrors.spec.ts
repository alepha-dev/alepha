import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { PulseServerErrors } from "../PulseServerErrors.ts";
import { PulseSinkProvider } from "../PulseSinkProvider.ts";

class FakeSink extends PulseSinkProvider {
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
  }).with({ provide: PulseSinkProvider, use: FakeSink });

const emitError = (alepha: Alepha, error: unknown) =>
  alepha.events.emit("server:onError", {
    route: { path: "/x" },
    request: {},
    error,
  } as any);

describe("PulseServerErrors", () => {
  it("tags a server crash as server-origin", async () => {
    const alepha = make();
    alepha.inject(PulseServerErrors);
    await alepha.start();

    await emitError(
      alepha,
      Object.assign(new Error("boom"), { name: "TypeError" }),
    );

    const sink = alepha.inject(PulseSinkProvider) as FakeSink;
    expect(sink.ingested[0].errors[0].name).toBe("TypeError");
    expect(sink.ingested[0].errors[0].origin).toBe("server");
    expect(sink.ingested[0].errors[0].sourceUrl).toBe("/x");
  });

  it("ignores 401 and 403, which are outcomes rather than crashes", async () => {
    const alepha = make();
    alepha.inject(PulseServerErrors);
    await alepha.start();

    // A logged-out visitor and an under-privileged one are routine traffic.
    // Reporting them buries the real errors under noise.
    await emitError(alepha, Object.assign(new Error("nope"), { status: 401 }));
    await emitError(alepha, Object.assign(new Error("nope"), { status: 403 }));

    expect(
      (alepha.inject(PulseSinkProvider) as FakeSink).ingested,
    ).toHaveLength(0);
  });

  it("still reports a 500", async () => {
    const alepha = make();
    alepha.inject(PulseServerErrors);
    await alepha.start();

    await emitError(
      alepha,
      Object.assign(new Error("db down"), { status: 500 }),
    );

    expect(
      (alepha.inject(PulseSinkProvider) as FakeSink).ingested,
    ).toHaveLength(1);
  });
});
