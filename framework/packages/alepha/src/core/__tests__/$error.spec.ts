import { describe, expectTypeOf, it } from "vitest";

import { $error, AlephaError, DeclaredError, z } from "../index.ts";

const QuotaExceeded = $error({
  name: "TEST_QUOTA_EXCEEDED",
  schema: z.object({ limit: z.number(), used: z.number() }),
  default: { limit: 5 },
  message: (data) => `Quota of ${data.limit} exceeded (${data.used})`,
});

const Busy = $error({ name: "TEST_BUSY", message: "Busy" });

const VeryBusy = Busy.extend({
  name: "TEST_VERY_BUSY",
  schema: z.object({ retryIn: z.number() }),
  default: { retryIn: 30 },
});

describe("$error", () => {
  describe("declaring", () => {
    it("returns a class named after the error, holding its schema and defaults", ({
      expect,
    }) => {
      expect(QuotaExceeded.name).toBe("TEST_QUOTA_EXCEEDED");
      expect(QuotaExceeded.schema).toBeDefined();
      expect(QuotaExceeded.defaults).toEqual({ limit: 5 });
      expect(Busy.schema).toBeUndefined();
    });

    it("builds an AlephaError carrying its name, data and message", ({
      expect,
    }) => {
      const error = new QuotaExceeded({ used: 6 });
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AlephaError);
      expect(error).toBeInstanceOf(DeclaredError);
      expect(error).toBeInstanceOf(QuotaExceeded);
      expect(error).not.toBeInstanceOf(Busy);
      expect(error.name).toBe("TEST_QUOTA_EXCEEDED");
      expect(error.data).toEqual({ limit: 5, used: 6 });
      expect(error.message).toBe("Quota of 5 exceeded (6)");
    });

    it("lets the caller override a default, the message and the cause", ({
      expect,
    }) => {
      const cause = new Error("db said no");
      const error = new QuotaExceeded(
        { limit: 10, used: 11 },
        { message: "Upgrade", cause },
      );
      expect(error.data.limit).toBe(10);
      expect(error.message).toBe("Upgrade");
      expect(error.cause).toBe(cause);
    });

    it("takes a message first when every data key is optional", ({
      expect,
    }) => {
      const cause = new Error("x");
      const error = new Busy("Try later", { cause });
      expect(error.message).toBe("Try later");
      expect(error.cause).toBe(cause);
      expect(new Busy().message).toBe("Busy");
    });
  });

  describe("extend", () => {
    it("derives a subclass, merging schema and defaults", ({ expect }) => {
      const error = new VeryBusy();
      expect(error).toBeInstanceOf(VeryBusy);
      expect(error).toBeInstanceOf(Busy);
      expect(error.name).toBe("TEST_VERY_BUSY");
      expect(error.message).toBe("Busy");
      expect(error.data).toEqual({ retryIn: 30 });
      expect(VeryBusy.schema?.shape.retryIn).toBeDefined();
    });
  });

  describe("typing", () => {
    it("types the constructor from the schema and the defaults", () => {
      expectTypeOf(new QuotaExceeded({ used: 1 }).data).toEqualTypeOf<{
        limit: number;
        used: number;
      }>();
      // @ts-expect-error `used` has no default
      void (() => new QuotaExceeded({}));
      // @ts-expect-error data is typed
      void (() => new QuotaExceeded({ used: "6" }));
      // @ts-expect-error a required key forbids the message shorthand
      void (() => new QuotaExceeded("msg"));
    });

    it("narrows with instanceof, both ways", () => {
      const value = new QuotaExceeded({ used: 1 }) as
        | string
        | InstanceType<typeof QuotaExceeded>;
      if (value instanceof QuotaExceeded) {
        expectTypeOf(value.data.used).toEqualTypeOf<number>();
      } else {
        expectTypeOf(value).toEqualTypeOf<string>();
      }
    });
  });

  describe("registry, toJSON and fromJSON", () => {
    it("registers every declared error by name, the last one winning", ({
      expect,
    }) => {
      expect(DeclaredError.registry.get("TEST_QUOTA_EXCEEDED")).toBe(
        QuotaExceeded,
      );
      const First = $error({ name: "TEST_RE_EVALUATED" });
      const Second = $error({ name: "TEST_RE_EVALUATED" });
      expect(First).not.toBe(Second);
      expect(DeclaredError.registry.get("TEST_RE_EVALUATED")).toBe(Second);
    });

    it("writes { name, message, data, cause }", ({ expect }) => {
      const error = new QuotaExceeded(
        { used: 6 },
        { cause: new Error("inner") },
      );
      expect(QuotaExceeded.toJSON(error)).toEqual({
        name: "TEST_QUOTA_EXCEEDED",
        message: "Quota of 5 exceeded (6)",
        data: { limit: 5, used: 6 },
        cause: { name: "Error", message: "inner" },
      });
      expect(Busy.toJSON(new Busy())).toEqual({
        name: "TEST_BUSY",
        message: "Busy",
      });
    });

    it("rebuilds the registered class without running its constructor", ({
      expect,
    }) => {
      const error = DeclaredError.fromJSON(
        QuotaExceeded.toJSON(new QuotaExceeded({ used: 6 }, { message: "X" })),
      );
      expect(error).toBeInstanceOf(QuotaExceeded);
      expect(error.message).toBe("X");
      expect(error.data).toEqual({ limit: 5, used: 6 });
    });

    it("rebuilds a descendant from its parent, never an unrelated class", ({
      expect,
    }) => {
      const json = VeryBusy.toJSON(new VeryBusy());
      expect(Busy.fromJSON(json)).toBeInstanceOf(VeryBusy);
      const unrelated = QuotaExceeded.fromJSON(json);
      expect(unrelated).not.toBeInstanceOf(VeryBusy);
      expect(unrelated.constructor).toBe(QuotaExceeded);
      expect(unrelated.name).toBe("TEST_VERY_BUSY");
    });

    it("falls back to the class it was called on for an unknown name or invalid data", ({
      expect,
    }) => {
      const unknown = Busy.fromJSON({ name: "NOPE", message: "m" });
      expect(unknown.constructor).toBe(Busy);
      expect(unknown.name).toBe("NOPE");

      const invalid = DeclaredError.fromJSON({
        name: "TEST_QUOTA_EXCEEDED",
        message: "m",
        data: { used: "six" },
      });
      expect(invalid).not.toBeInstanceOf(QuotaExceeded);
      expect(invalid.data).toEqual({ used: "six" });
    });
  });

  describe("find", () => {
    it("finds an error in a cause chain", ({ expect }) => {
      const inner = new Busy();
      const outer = new AlephaError("wrapped", {
        cause: new Error("middle", { cause: inner }),
      });
      expect(Busy.find(outer)).toBe(inner);
      expect(QuotaExceeded.find(outer)).toBeUndefined();
      expect(Busy.find("nope")).toBeUndefined();
    });
  });
});
