import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import {
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  RawFormatterProvider,
} from "../index.ts";
import { Logger } from "../services/Logger.ts";

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "trace" } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: LogFormatterProvider, use: RawFormatterProvider });

  const logger = alepha.inject(Logger, {
    lifetime: "transient",
    args: ["TestService", "test.module"],
  });

  return { logger, memory: alepha.inject(MemoryDestinationProvider) };
};

describe("Logger — secret redaction", () => {
  it("redacts credential-bearing keys from log data", () => {
    const { logger, memory } = setup();

    logger.info("request", {
      headers: {
        authorization: "Bearer super-secret-token",
        cookie: "session=abc123",
        "content-type": "application/json",
      },
      password: "hunter2",
      apiKey: "ak_live_123",
      refreshToken: "rt_456",
      userId: "user-1",
    });

    const [entry] = memory.logs;
    const serialized = JSON.stringify(entry.data);

    // None of the secret values may reach a formatter, a destination, or
    // devtools — one `log.debug("req", { headers })` used to ship bearer
    // tokens straight to stdout and the log aggregator.
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("ak_live_123");
    expect(serialized).not.toContain("rt_456");

    // Non-secret context must survive — redaction that eats the diagnostics
    // is not useful.
    expect(serialized).toContain("user-1");
    expect(serialized).toContain("application/json");
  });

  it("redacts nested and array-held secrets", () => {
    const { logger, memory } = setup();

    logger.info("nested", {
      outer: {
        inner: { set_cookie: "s=1", secret: "shh" },
        list: [{ token: "t-1" }, { safe: "keep" }],
      },
    });

    const serialized = JSON.stringify(memory.logs[0].data);
    expect(serialized).not.toContain("s=1");
    expect(serialized).not.toContain("shh");
    expect(serialized).not.toContain("t-1");
    expect(serialized).toContain("keep");
  });

  it("does not mangle Errors, cycles, or non-plain values", () => {
    const { logger, memory } = setup();

    const cyclic: Record<string, unknown> = { name: "root", password: "p" };
    cyclic.self = cyclic;

    expect(() => logger.info("cyclic", cyclic)).not.toThrow();
    expect(JSON.stringify(memory.logs[0].data)).not.toContain('"p"');

    const error = new Error("boom");
    expect(() => logger.error("failed", error)).not.toThrow();
    const logged = memory.logs[1].data;
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).message).toBe("boom");
  });
});
