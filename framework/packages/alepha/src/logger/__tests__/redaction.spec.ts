import { $error, Alepha, AlephaError, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  JsonFormatterProvider,
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  RawFormatterProvider,
} from "../index.ts";
import { Logger } from "../services/Logger.ts";

const setup = (
  formatter: typeof LogFormatterProvider = RawFormatterProvider,
) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "trace" } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: LogFormatterProvider, use: formatter });

  const logger = alepha.inject(Logger, {
    lifetime: "transient",
    args: ["TestService", "test.module"],
  });

  return { alepha, logger, memory: alepha.inject(MemoryDestinationProvider) };
};

/**
 * The number of values in a logged tree, containers included.
 */
const countNodes = (value: unknown): number => {
  if (value === null || typeof value !== "object") {
    return 1;
  }
  let count = 1;
  for (const item of Object.values(value)) {
    count += countNodes(item);
  }
  return count;
};

describe("Logger: secret redaction", () => {
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
    // devtools: one `log.debug("req", { headers })` used to ship bearer
    // tokens straight to stdout and the log aggregator.
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("ak_live_123");
    expect(serialized).not.toContain("rt_456");

    // Non-secret context must survive: redaction that eats the diagnostics
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

  it("redacts plain objects held in arrays of arrays", () => {
    const { logger, memory } = setup();

    logger.info("deep", {
      rows: [[{ password: "pw-1", id: 1 }], [[{ apiKey: "ak-2", id: 2 }]]],
    });

    expect(memory.logs[0].data).toEqual({
      rows: [
        [{ password: "[redacted]", id: 1 }],
        [[{ apiKey: "[redacted]", id: 2 }]],
      ],
    });
  });

  it("passes an Error through and never throws on a cycle", () => {
    const { logger, memory } = setup();

    const cyclic: Record<string, unknown> = { name: "root", password: "p" };
    cyclic.self = cyclic;

    expect(() => logger.info("cyclic", cyclic)).not.toThrow();
    expect(memory.logs[0].data).toEqual({
      name: "root",
      password: "[redacted]",
      self: "[circular]",
    });

    const error = new Error("boom");
    expect(() => logger.error("failed", error)).not.toThrow();
    logger.error("failed", { error });
    expect(memory.logs[1].data).toBe(error);
    expect((memory.logs[2].data as { error: Error }).error).toBe(error);
  });

  it("still redacts the fields of a class instance", () => {
    const { logger, memory } = setup();

    class Account {
      public id = "acc-1";
      public password = "instance-secret";
    }

    logger.info("account", { account: new Account() });

    expect(memory.logs[0].data).toEqual({
      account: { id: "acc-1", password: "[redacted]" },
    });
  });

  it("never calls a toJSON(), and copies any object by its own fields", () => {
    const { logger, memory } = setup();
    let calls = 0;

    class Session {
      public id = "sess-1";
      public toJSON() {
        calls++;
        return { token: "json-secret" };
      }
    }

    logger.info("values", {
      session: new Session(),
      url: new URL("https://example.app/x?token=url-secret"),
      map: new Map([["token", "map-secret"]]),
      set: new Set(["set-secret"]),
    });

    expect(memory.logs[0].data).toEqual({
      session: { id: "sess-1" },
      url: {},
      map: {},
      set: {},
    });
    expect(calls).toBe(0);
  });

  it("writes an object referenced twice in both places", () => {
    const { logger, memory } = setup();
    const shared = { x: 1, token: "shared-secret" };

    logger.info("shared", { a: shared, b: shared, list: [shared, shared] });

    const copy = { x: 1, token: "[redacted]" };
    expect(memory.logs[0].data).toEqual({
      a: copy,
      b: copy,
      list: [copy, copy],
    });
  });

  it("marks a cycle at the spot where it closes, and only there", () => {
    const { logger, memory } = setup();
    const child: Record<string, unknown> = { name: "child" };
    const root = { child, again: child };
    child.root = root;

    logger.info("cycle", root);

    const copy = { name: "child", root: "[circular]" };
    expect(memory.logs[0].data).toEqual({ child: copy, again: copy });
  });

  it("replaces the whole data when it cannot be read", () => {
    const { logger, memory } = setup();

    // The getter comes first: nothing is read before it throws.
    const flat = {
      get broken(): string {
        throw new AlephaError("no read");
      },
      id: 1,
    };
    const nested = {
      password: "getter-secret",
      inner: {
        get broken(): string {
          throw new AlephaError("no read");
        },
      },
    };

    expect(() => logger.info("flat", flat)).not.toThrow();
    expect(() => logger.info("nested", nested)).not.toThrow();

    expect(memory.logs[0].data).toEqual({ redaction: "[unserializable]" });
    expect(memory.logs[1].data).toEqual({ redaction: "[unserializable]" });
  });

  describe("Errors stay the instances they were", () => {
    const Refused = $error({
      name: "LOGGER_SPEC_REFUSED",
      schema: z.object({ reason: z.text() }),
      message: "Refused",
    });

    it("hands a declared error to log:entry as the same instance", () => {
      const { alepha, logger } = setup();
      const seen: unknown[] = [];
      alepha.events.on("log:entry", ({ entry }) => {
        seen.push(entry.data);
      });

      // A consumer that reports errors once tells them apart by identity.
      const error = new Refused({ reason: "quota" });
      logger.error("top", error);
      logger.error("nested", { error });
      logger.error("listed", { errors: [error] });

      expect(seen).toHaveLength(3);
      expect(seen[0]).toBe(error);
      expect((seen[1] as { error: unknown }).error).toBe(error);
      expect((seen[2] as { errors: unknown[] }).errors[0]).toBe(error);
    });

    it("logs an Error whose name is a brand-checked accessor on the json formatter", () => {
      const { logger, memory } = setup(JsonFormatterProvider);
      const error = Object.assign(new DOMException("m", "AbortError"), {
        ctx: { a: 1 },
      });

      expect(() => {
        logger.error("top", error);
        logger.error("nested", { failure: error });
      }).not.toThrow();

      expect(memory.logs[0].data).toBe(error);
      expect(memory.logs[1].formatted).toContain('"name":"AbortError"');
    });
  });

  describe("bounds", () => {
    const chain = (length: number) => {
      let deep: Record<string, unknown> = { password: "deep-secret", end: 1 };
      for (let i = 1; i < length; i++) {
        deep = { next: deep };
      }
      return deep;
    };

    const depthOf = (value: unknown) => {
      let cursor = value;
      let depth = 0;
      while (cursor !== null && typeof cursor === "object") {
        cursor = (cursor as Record<string, unknown>).next;
        depth++;
      }
      return { depth, end: cursor };
    };

    it("writes 100 levels of nesting and cuts the 101st", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      logger.info("fits", chain(100));
      logger.info("cut", chain(101));

      expect(depthOf(memory.logs[0].data)).toEqual({
        depth: 100,
        end: undefined,
      });
      expect(memory.logs[0].formatted).toContain('"password":"[redacted]"');
      expect(depthOf(memory.logs[1].data)).toEqual({
        depth: 100,
        end: "[truncated]",
      });
      expect(memory.logs[1].formatted).not.toContain("deep-secret");
    });

    it("cuts a chain far deeper than the stack, and still masks what lies above", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      expect(() =>
        logger.info("deep", {
          password: "shallow-secret",
          deep: chain(20_000),
        }),
      ).not.toThrow();

      const data = memory.logs[0].data as Record<string, unknown>;
      expect(data.password).toBe("[redacted]");
      expect(depthOf(data.deep)).toEqual({ depth: 99, end: "[truncated]" });
      expect(memory.logs[0].formatted).not.toContain("secret");
    });

    it("stops at 10 000 values on records that each hold the one before", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      const entries: Record<string, unknown>[] = [];
      for (let i = 0; i < 20_000; i++) {
        entries.push({
          id: i,
          prev: entries[i - 1],
          token: `chain-secret-${i}`,
        });
      }

      expect(() => logger.info("entries", { entries })).not.toThrow();

      const [entry] = memory.logs;
      const nodes = countNodes(entry.data);
      expect(nodes).toBeGreaterThan(9_000);
      expect(nodes).toBeLessThan(10_500);
      expect(entry.formatted).toContain("[truncated]");
      expect(entry.formatted).toContain('"token":"[redacted]"');
      expect(entry.formatted).not.toContain("chain-secret");
      const logged = (entry.data as { entries: unknown[] }).entries;
      expect(logged.at(-1)).toBe("[truncated]");
      expect(logged.length).toBeLessThan(20_000);
    });

    it("stops at 10 000 values on a diamond of 2^25 paths, on an enabled json line", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      let node: Record<string, unknown> = { id: "leaf", token: "leaf-secret" };
      for (let i = 0; i < 25; i++) {
        node = { a: node, b: node };
      }

      expect(() => logger.info("diamond", node)).not.toThrow();

      const [entry] = memory.logs;
      const nodes = countNodes(entry.data);
      expect(nodes).toBeGreaterThan(9_000);
      expect(nodes).toBeLessThan(10_500);
      expect(entry.formatted).toContain("[truncated]");
      expect(entry.formatted).toContain('"token":"[redacted]"');
      expect(entry.formatted).not.toContain("leaf-secret");

      // The leftmost path is written whole.
      let cursor = entry.data as Record<string, unknown>;
      for (let i = 0; i < 25; i++) {
        cursor = cursor.a as Record<string, unknown>;
      }
      expect(cursor).toEqual({ id: "leaf", token: "[redacted]" });
    });

    it("reads the own keys of an object only, as Object.entries did", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      const wide: Record<string, number> = {};
      for (let i = 0; i < 1_000_000; i++) {
        wide[`k${i}`] = i;
      }
      const refusing = new Proxy(
        {},
        {
          ownKeys() {
            throw new AlephaError("no keys");
          },
        },
      );

      logger.info("inherited", {
        heir: Object.assign(Object.create(wide), { own: 1 }),
        after: "kept",
      });
      logger.info("proxy", {
        held: Object.assign(Object.create(refusing), { own: 1 }),
      });

      // Inherited keys are neither written nor charged to the budget.
      expect(memory.logs[0].data).toEqual({ heir: { own: 1 }, after: "kept" });
      expect(memory.logs[1].data).toEqual({ held: { own: 1 } });
    });

    it("reads a 10 MB typed array by index, up to the budget", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      logger.info("bytes", { bytes: new Uint8Array(10_000_000).fill(7) });

      const [entry] = memory.logs;
      const bytes = (entry.data as { bytes: Record<string, unknown> }).bytes;
      expect(countNodes(entry.data)).toBeLessThan(10_500);
      expect(Array.isArray(bytes)).toBe(false);
      expect(bytes["0"]).toBe(7);
      expect(bytes["[truncated]"]).toBe("[truncated]");

      logger.info("small", { bytes: new Uint8Array([1, 2]) });
      expect(memory.logs[1].data).toEqual({ bytes: { "0": 1, "1": 2 } });
    });

    it("stops at 10 000 values on an object of 1 000 000 keys, flat or not", () => {
      const { logger, memory } = setup(JsonFormatterProvider);

      const flat: Record<string, unknown> = {};
      for (let i = 0; i < 1_000_000; i++) {
        flat[`k${i}`] = i;
      }
      const nested = { ...flat, inner: { password: "wide-secret" } };

      expect(() => {
        logger.info("flat", flat);
        logger.info("nested", nested);
        logger.info("array", { list: Object.values(flat) });
      }).not.toThrow();

      for (const entry of memory.logs) {
        const nodes = countNodes(entry.data);
        expect(nodes).toBeGreaterThan(9_000);
        expect(nodes).toBeLessThan(10_500);
        expect(entry.formatted).toContain("[truncated]");
        expect(entry.formatted).not.toContain("wide-secret");
      }
    });
  });
});
