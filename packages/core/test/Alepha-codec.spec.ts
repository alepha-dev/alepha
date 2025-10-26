import { describe, expect, it } from "vitest";
import { Alepha, t } from "../src";

describe("Alepha-codec", () => {
  describe("decode - primitives", () => {
    it("should decode string", () => {
      const alepha = Alepha.create();
      const schema = t.string();
      expect(alepha.codec.decode(schema, "hello")).toBe("hello");
    });

    it("should decode number", () => {
      const alepha = Alepha.create();
      const schema = t.number();
      expect(alepha.codec.decode(schema, 42)).toBe(42);
      expect(alepha.codec.decode(schema, 3.14)).toBe(3.14);
    });

    it("should decode integer", () => {
      const alepha = Alepha.create();
      const schema = t.int();
      expect(alepha.codec.decode(schema, 42)).toBe(42);
    });

    it("should decode boolean", () => {
      const alepha = Alepha.create();
      const schema = t.boolean();
      expect(alepha.codec.decode(schema, true)).toBe(true);
      expect(alepha.codec.decode(schema, false)).toBe(false);
    });

    it("should decode null", () => {
      const alepha = Alepha.create();
      const schema = t.null();
      expect(alepha.codec.decode(schema, null)).toBe(null);
    });

    it("should decode bigint", () => {
      const alepha = Alepha.create();
      const schema = t.bigint();
      expect(alepha.codec.decode(schema, 9007199254740991n)).toBe(
        9007199254740991n,
      );
    });
  });

  describe("decode - simple objects", () => {
    it("should decode simple object", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
      });

      const obj = {
        id: 1,
        titi: undefined,
        toto() {
          return "toto";
        },
        tata: () => "tata",
      };

      expect(alepha.codec.decode(schema, obj)).toStrictEqual({ id: 1 });

      // original object not mutated
      expect(obj.toto).toBeDefined();
      expect(obj.tata).toBeDefined();
    });

    it("should decode object with multiple fields", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string(),
        active: t.boolean(),
      });

      const result = alepha.codec.decode(schema, {
        id: 1,
        name: "John",
        active: true,
      });

      expect(result).toStrictEqual({ id: 1, name: "John", active: true });
    });

    it("should decode object and strip extra properties", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string(),
      });

      const result = alepha.codec.decode(schema, {
        id: 1,
        name: "John",
        extra: "should be removed",
        another: 123,
      });

      expect(result).toStrictEqual({ id: 1, name: "John" });
      expect(result).not.toHaveProperty("extra");
      expect(result).not.toHaveProperty("another");
    });

    it("should decode object with optional fields", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.optional(t.string()),
        description: t.optional(t.string()),
      });

      expect(
        alepha.codec.decode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({
        id: 1,
        name: "John",
      });

      expect(alepha.codec.decode(schema, { id: 1 })).toStrictEqual({ id: 1 });
    });

    it("should decode object with default values", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string({ default: "Unknown" }),
        count: t.number({ default: 0 }),
      });

      expect(alepha.codec.decode(schema, { id: 1 })).toStrictEqual({
        id: 1,
        name: "Unknown",
        count: 0,
      });
    });
  });

  describe("decode - nested objects", () => {
    it("should decode nested object", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        user: t.object({
          name: t.string(),
          email: t.string(),
        }),
      });

      const result = alepha.codec.decode(schema, {
        id: 1,
        user: {
          name: "John",
          email: "john@example.com",
        },
      });

      expect(result).toStrictEqual({
        id: 1,
        user: {
          name: "John",
          email: "john@example.com",
        },
      });
    });

    it("should decode deeply nested objects", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        level1: t.object({
          level2: t.object({
            level3: t.object({
              value: t.string(),
            }),
          }),
        }),
      });

      const result = alepha.codec.decode(schema, {
        level1: {
          level2: {
            level3: {
              value: "deep",
            },
          },
        },
      });

      expect(result.level1.level2.level3.value).toBe("deep");
    });

    it("should decode nested objects and strip extra properties at all levels", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        user: t.object({
          name: t.string(),
        }),
      });

      const result = alepha.codec.decode(schema, {
        id: 1,
        extra: "top level",
        user: {
          name: "John",
          extra: "nested level",
        },
      });

      expect(result).toStrictEqual({
        id: 1,
        user: {
          name: "John",
        },
      });
    });
  });

  describe("decode - arrays", () => {
    it("should decode array of primitives", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.number());

      expect(alepha.codec.decode(schema, [1, 2, 3])).toStrictEqual([1, 2, 3]);
    });

    it("should decode array of strings", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.string());

      expect(alepha.codec.decode(schema, ["a", "b", "c"])).toStrictEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("should decode array of objects", () => {
      const alepha = Alepha.create();
      const schema = t.array(
        t.object({
          id: t.number(),
          name: t.string(),
        }),
      );

      const result = alepha.codec.decode(schema, [
        { id: 1, name: "John" },
        { id: 2, name: "Jane" },
      ]);

      expect(result).toStrictEqual([
        { id: 1, name: "John" },
        { id: 2, name: "Jane" },
      ]);
    });

    it("should decode array of objects and strip extra properties", () => {
      const alepha = Alepha.create();
      const schema = t.array(
        t.object({
          id: t.number(),
        }),
      );

      const result = alepha.codec.decode(schema, [
        { id: 1, extra: "remove" },
        { id: 2, another: "remove" },
      ]);

      expect(result).toStrictEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should decode empty array", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.number());

      expect(alepha.codec.decode(schema, [])).toStrictEqual([]);
    });

    it("should decode nested arrays", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.array(t.number()));

      expect(
        alepha.codec.decode(schema, [
          [1, 2],
          [3, 4],
        ]),
      ).toStrictEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe("decode - object with arrays", () => {
    it("should decode object with array field", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        tags: t.array(t.string()),
      });

      expect(
        alepha.codec.decode(schema, {
          id: 1,
          tags: ["a", "b", "c"],
        }),
      ).toStrictEqual({
        id: 1,
        tags: ["a", "b", "c"],
      });
    });

    it("should decode object with array of objects", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        items: t.array(
          t.object({
            name: t.string(),
            quantity: t.number(),
          }),
        ),
      });

      const result = alepha.codec.decode(schema, {
        id: 1,
        items: [
          { name: "Item 1", quantity: 5 },
          { name: "Item 2", quantity: 10 },
        ],
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toStrictEqual({ name: "Item 1", quantity: 5 });
    });
  });

  describe("decode - enums", () => {
    it("should decode enum value", () => {
      const alepha = Alepha.create();
      const schema = t.enum(["pending", "active", "archived"]);

      expect(alepha.codec.decode(schema, "pending")).toBe("pending");
      expect(alepha.codec.decode(schema, "active")).toBe("active");
    });

    it("should decode object with enum field", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        status: t.enum(["pending", "active", "archived"]),
      });

      expect(
        alepha.codec.decode(schema, {
          id: 1,
          status: "active",
        }),
      ).toStrictEqual({
        id: 1,
        status: "active",
      });
    });

    it("should decode object with multiple enum fields", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        status: t.enum(["pending", "active"]),
        role: t.enum(["user", "admin"]),
      });

      expect(
        alepha.codec.decode(schema, {
          status: "active",
          role: "admin",
        }),
      ).toStrictEqual({
        status: "active",
        role: "admin",
      });
    });
  });

  describe("decode - unions", () => {
    it("should decode union of primitives", () => {
      const alepha = Alepha.create();
      const schema = t.union([t.string(), t.number()]);

      expect(alepha.codec.decode(schema, "hello")).toBe("hello");
      expect(alepha.codec.decode(schema, 42)).toBe(42);
    });

    it("should decode union of objects", () => {
      const alepha = Alepha.create();
      const schema = t.union([
        t.object({ type: t.const("user"), name: t.string() }),
        t.object({ type: t.const("admin"), level: t.number() }),
      ]);

      expect(
        alepha.codec.decode(schema, { type: "user", name: "John" }),
      ).toStrictEqual({ type: "user", name: "John" });

      expect(
        alepha.codec.decode(schema, { type: "admin", level: 5 }),
      ).toStrictEqual({ type: "admin", level: 5 });
    });

    it("should decode nullable field (union with null)", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.union([t.string(), t.null()]),
      });

      expect(
        alepha.codec.decode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({ id: 1, name: "John" });

      expect(alepha.codec.decode(schema, { id: 1, name: null })).toStrictEqual({
        id: 1,
        name: null,
      });
    });
  });

  describe("decode - records", () => {
    it("should decode record with string values", () => {
      const alepha = Alepha.create();
      const schema = t.record(t.string(), t.string());

      expect(
        alepha.codec.decode(schema, {
          key1: "value1",
          key2: "value2",
        }),
      ).toStrictEqual({
        key1: "value1",
        key2: "value2",
      });
    });

    it("should decode record with number values", () => {
      const alepha = Alepha.create();
      const schema = t.record(t.string(), t.number());

      expect(
        alepha.codec.decode(schema, {
          count1: 10,
          count2: 20,
        }),
      ).toStrictEqual({
        count1: 10,
        count2: 20,
      });
    });

    it("should decode record with object values", () => {
      const alepha = Alepha.create();
      const schema = t.record(
        t.string(),
        t.object({
          value: t.number(),
        }),
      );

      expect(
        alepha.codec.decode(schema, {
          item1: { value: 1 },
          item2: { value: 2 },
        }),
      ).toStrictEqual({
        item1: { value: 1 },
        item2: { value: 2 },
      });
    });
  });

  describe("decode - special formats", () => {
    it("should decode UUID", () => {
      const alepha = Alepha.create();
      const schema = t.uuid();
      const uuid = "550e8400-e29b-41d4-a716-446655440000";

      expect(alepha.codec.decode(schema, uuid)).toBe(uuid);
    });

    it("should decode email", () => {
      const alepha = Alepha.create();
      const schema = t.email();

      expect(alepha.codec.decode(schema, "test@example.com")).toBe(
        "test@example.com",
      );
    });

    it("should decode e164 phone number", () => {
      const alepha = Alepha.create();
      const schema = t.e164();

      expect(alepha.codec.decode(schema, "+1234567890")).toBe("+1234567890");
    });

    it("should decode bcp47 language tag", () => {
      const alepha = Alepha.create();
      const schema = t.bcp47();

      expect(alepha.codec.decode(schema, "en-US")).toBe("en-US");
      expect(alepha.codec.decode(schema, "fr")).toBe("fr");
    });

    it("should decode short text", () => {
      const alepha = Alepha.create();
      const schema = t.shortText();

      expect(alepha.codec.decode(schema, "Short title")).toBe("Short title");
    });

    it("should decode long text", () => {
      const alepha = Alepha.create();
      const schema = t.longText();

      expect(
        alepha.codec.decode(
          schema,
          "This is a longer description that can contain more characters",
        ),
      ).toBe("This is a longer description that can contain more characters");
    });

    it("should decode rich text", () => {
      const alepha = Alepha.create();
      const schema = t.richText();

      expect(
        alepha.codec.decode(schema, "<h1>HTML Content</h1><p>Paragraph</p>"),
      ).toBe("<h1>HTML Content</h1><p>Paragraph</p>");
    });

    it("should decode snake case", () => {
      const alepha = Alepha.create();
      const schema = t.snakeCase();

      expect(alepha.codec.decode(schema, "LIKE_THIS")).toBe("LIKE_THIS");
      expect(alepha.codec.decode(schema, "STATUS-ACTIVE")).toBe(
        "STATUS-ACTIVE",
      );
    });

    it("should decode value label object", () => {
      const alepha = Alepha.create();
      const schema = t.valueLabel();

      expect(
        alepha.codec.decode(schema, {
          value: "OPTION_A",
          label: "Option A",
          description: "This is option A",
        }),
      ).toStrictEqual({
        value: "OPTION_A",
        label: "Option A",
        description: "This is option A",
      });
    });

    it("should decode json object", () => {
      const alepha = Alepha.create();
      const schema = t.json();

      expect(
        alepha.codec.decode(schema, {
          key1: "value1",
          key2: 123,
          key3: true,
        }),
      ).toStrictEqual({
        key1: "value1",
        key2: 123,
        key3: true,
      });
    });
  });

  describe("decode - codec types", () => {
    it("should decode datetime from string to Date", () => {
      const alepha = Alepha.create();
      const schema = t.datetime();
      const datetime = "2024-01-01T00:00:00.000Z";

      const result = alepha.codec.decode(schema, datetime);
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe(datetime);
    });

    it("should decode date from string to Date", () => {
      const alepha = Alepha.create();
      const schema = t.date();
      const dateString = "2024-01-01";

      const result = alepha.codec.decode(schema, dateString);
      expect(result).toBeInstanceOf(Date);
    });

    it("should decode url from string to URL", () => {
      const alepha = Alepha.create();
      const schema = t.url();
      const urlString = "https://example.com/path";

      const result = alepha.codec.decode(schema, urlString);
      expect(result).toBeInstanceOf(URL);
      expect(result.toString()).toBe(urlString);
    });

    it("should decode binary from base64 string to Uint8Array", () => {
      const alepha = Alepha.create();
      const schema = t.binary({});

      // "hello" in base64 is "aGVsbG8="
      const result = alepha.codec.decode(schema, "aGVsbG8=");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toStrictEqual([104, 101, 108, 108, 111]);
    });

    it("should decode bigint from string to BigInt", () => {
      const alepha = Alepha.create();
      const schema = t.bigint();

      const result = alepha.codec.decode(schema, "9007199254740991");
      expect(typeof result).toBe("bigint");
      expect(result).toBe(9007199254740991n);
    });

    it("should decode bigint from number to BigInt", () => {
      const alepha = Alepha.create();
      const schema = t.bigint();

      const result = alepha.codec.decode(schema, 123);
      expect(typeof result).toBe("bigint");
      expect(result).toBe(123n);
    });
  });

  describe("decode - literals", () => {
    it("should decode string literal", () => {
      const alepha = Alepha.create();
      const schema = t.const("hello");

      expect(alepha.codec.decode(schema, "hello")).toBe("hello");
    });

    it("should decode number literal", () => {
      const alepha = Alepha.create();
      const schema = t.const(42);

      expect(alepha.codec.decode(schema, 42)).toBe(42);
    });

    it("should decode boolean literal", () => {
      const alepha = Alepha.create();
      const schema = t.const(true);

      expect(alepha.codec.decode(schema, true)).toBe(true);
    });

    it("should decode object with literal discriminator", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        type: t.const("user"),
        name: t.string(),
      });

      expect(
        alepha.codec.decode(schema, { type: "user", name: "John" }),
      ).toStrictEqual({ type: "user", name: "John" });
    });
  });

  describe("encode - primitives", () => {
    it("should encode string", () => {
      const alepha = Alepha.create();
      const schema = t.string();

      expect(alepha.codec.encode(schema, "hello")).toBe("hello");
    });

    it("should encode number", () => {
      const alepha = Alepha.create();
      const schema = t.number();

      expect(alepha.codec.encode(schema, 42)).toBe(42);
    });

    it("should encode boolean", () => {
      const alepha = Alepha.create();
      const schema = t.boolean();

      expect(alepha.codec.encode(schema, true)).toBe(true);
    });

    it("should encode null", () => {
      const alepha = Alepha.create();
      const schema = t.null();

      expect(alepha.codec.encode(schema, null)).toBe(null);
    });
  });

  describe("encode - objects", () => {
    it("should encode simple object", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string(),
      });

      expect(
        alepha.codec.encode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({ id: 1, name: "John" });
    });

    it("should encode nested object", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        user: t.object({
          name: t.string(),
        }),
      });

      expect(
        alepha.codec.encode(schema, {
          id: 1,
          user: { name: "John" },
        }),
      ).toStrictEqual({
        id: 1,
        user: { name: "John" },
      });
    });
    3;
    it("should encode object with optional fields omitted", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.optional(t.string()),
      });

      expect(alepha.codec.encode(schema, { id: 1 })).toStrictEqual({ id: 1 });
    });

    it("should encode object with optional fields present", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.optional(t.string()),
      });

      expect(
        alepha.codec.encode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({ id: 1, name: "John" });
    });
  });

  describe("encode - arrays", () => {
    it("should encode array of primitives", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.number());

      expect(alepha.codec.encode(schema, [1, 2, 3])).toStrictEqual([1, 2, 3]);
    });

    it("should encode array of objects", () => {
      const alepha = Alepha.create();
      const schema = t.array(
        t.object({
          id: t.number(),
        }),
      );

      expect(alepha.codec.encode(schema, [{ id: 1 }, { id: 2 }])).toStrictEqual(
        [{ id: 1 }, { id: 2 }],
      );
    });

    it("should encode empty array", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.string());

      expect(alepha.codec.encode(schema, [])).toStrictEqual([]);
    });
  });

  describe("encode - enums", () => {
    it("should encode enum value", () => {
      const alepha = Alepha.create();
      const schema = t.enum(["pending", "active"]);

      expect(alepha.codec.encode(schema, "pending")).toBe("pending");
    });

    it("should encode object with enum", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        status: t.enum(["pending", "active"]),
      });

      expect(alepha.codec.encode(schema, { status: "active" })).toStrictEqual({
        status: "active",
      });
    });
  });

  describe("encode - records", () => {
    it("should encode record", () => {
      const alepha = Alepha.create();
      const schema = t.record(t.string(), t.number());

      expect(
        alepha.codec.encode(schema, {
          a: 1,
          b: 2,
        }),
      ).toStrictEqual({
        a: 1,
        b: 2,
      });
    });

    it("should encode record with object values", () => {
      const alepha = Alepha.create();
      const schema = t.record(
        t.string(),
        t.object({
          value: t.number(),
        }),
      );

      expect(
        alepha.codec.encode(schema, {
          item1: { value: 1 },
        }),
      ).toStrictEqual({
        item1: { value: 1 },
      });
    });
  });

  describe("encode - codec types", () => {
    it("should encode Date to ISO string", () => {
      const alepha = Alepha.create();
      const schema = t.datetime();
      const date = new Date("2024-01-01T00:00:00.000Z");

      const result = alepha.codec.encode(schema, date);
      expect(typeof result).toBe("string");
      expect(result).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should encode Date to date string (YYYY-MM-DD)", () => {
      const alepha = Alepha.create();
      const schema = t.date();
      const date = new Date("2024-01-15T12:34:56.789Z");

      const result = alepha.codec.encode(schema, date);
      expect(typeof result).toBe("string");
      expect(result).toBe("2024-01-15");
    });

    it("should encode URL to string", () => {
      const alepha = Alepha.create();
      const schema = t.url();
      const url = new URL("https://example.com/path?query=value");

      const result = alepha.codec.encode(schema, url);
      expect(typeof result).toBe("string");
      expect(result).toBe("https://example.com/path?query=value");
    });

    it("should encode Uint8Array to base64 string", () => {
      const alepha = Alepha.create();
      const schema = t.binary({});
      const data = new Uint8Array([104, 101, 108, 108, 111]); // "hello"

      const result = alepha.codec.encode(schema, data);
      expect(typeof result).toBe("string");
      expect(result).toBe("aGVsbG8=");
    });

    it("should encode bigint to string", () => {
      const alepha = Alepha.create();
      const schema = t.bigint();

      const result = alepha.codec.encode(schema, 9007199254740991n);
      expect(typeof result).toBe("string");
      expect(result).toBe("9007199254740991");
    });
  });

  describe("encode - special formats", () => {
    it("should encode email", () => {
      const alepha = Alepha.create();
      const schema = t.email();

      expect(alepha.codec.encode(schema, "test@example.com")).toBe(
        "test@example.com",
      );
    });

    it("should encode e164 phone number", () => {
      const alepha = Alepha.create();
      const schema = t.e164();

      expect(alepha.codec.encode(schema, "+1234567890")).toBe("+1234567890");
    });

    it("should encode UUID", () => {
      const alepha = Alepha.create();
      const schema = t.uuid();
      const uuid = "550e8400-e29b-41d4-a716-446655440000";

      expect(alepha.codec.encode(schema, uuid)).toBe(uuid);
    });

    it("should encode value label object", () => {
      const alepha = Alepha.create();
      const schema = t.valueLabel();

      expect(
        alepha.codec.encode(schema, {
          value: "STATUS_ACTIVE",
          label: "Active",
          description: "User is active",
        }),
      ).toStrictEqual({
        value: "STATUS_ACTIVE",
        label: "Active",
        description: "User is active",
      });
    });

    it("should encode json object", () => {
      const alepha = Alepha.create();
      const schema = t.json();

      expect(
        alepha.codec.encode(schema, {
          key1: "value1",
          key2: 123,
        }),
      ).toStrictEqual({
        key1: "value1",
        key2: 123,
      });
    });
  });

  describe("encodeToString - primitives", () => {
    it("should encode string to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.string();

      expect(alepha.codec.encodeToString(schema, "hello")).toBe('"hello"');
    });

    it("should encode number to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.number();

      expect(alepha.codec.encodeToString(schema, 42)).toBe("42");
    });

    it("should encode boolean to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.boolean();

      expect(alepha.codec.encodeToString(schema, true)).toBe("true");
      expect(alepha.codec.encodeToString(schema, false)).toBe("false");
    });

    it("should encode null to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.null();

      expect(alepha.codec.encodeToString(schema, null)).toBe("null");
    });
  });

  describe("encodeToString - objects", () => {
    it("should encode simple object to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string(),
      });

      const result = alepha.codec.encodeToString(schema, {
        id: 1,
        name: "John",
      });
      expect(JSON.parse(result)).toStrictEqual({ id: 1, name: "John" });
    });

    it("should encode nested object to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        user: t.object({
          name: t.string(),
          age: t.number(),
        }),
      });

      const result = alepha.codec.encodeToString(schema, {
        id: 1,
        user: {
          name: "John",
          age: 30,
        },
      });

      const parsed = JSON.parse(result);
      expect(parsed).toStrictEqual({
        id: 1,
        user: {
          name: "John",
          age: 30,
        },
      });
    });

    it("should encode empty object to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.object({});

      expect(alepha.codec.encodeToString(schema, {})).toBe("{}");
    });
  });

  describe("encodeToString - arrays", () => {
    it("should encode array of primitives to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.number());

      const result = alepha.codec.encodeToString(schema, [1, 2, 3]);
      expect(JSON.parse(result)).toStrictEqual([1, 2, 3]);
    });

    it("should encode array of objects to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.array(
        t.object({
          id: t.number(),
        }),
      );

      const result = alepha.codec.encodeToString(schema, [
        { id: 1 },
        { id: 2 },
      ]);
      expect(JSON.parse(result)).toStrictEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should encode empty array to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.string());

      expect(alepha.codec.encodeToString(schema, [])).toBe("[]");
    });
  });

  describe("encodeToString - complex structures", () => {
    it("should encode complex nested structure", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        users: t.array(
          t.object({
            name: t.string(),
            roles: t.array(t.string()),
            metadata: t.record(t.string(), t.string()),
          }),
        ),
      });

      const data = {
        id: 1,
        users: [
          {
            name: "John",
            roles: ["admin", "user"],
            metadata: { key: "value" },
          },
        ],
      };

      const result = alepha.codec.encodeToString(schema, data);
      expect(JSON.parse(result)).toStrictEqual(data);
    });

    it("should encode Date objects to ISO string in JSON", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        createdAt: t.datetime(),
      });

      const date = new Date("2024-01-01T00:00:00.000Z");
      const result = alepha.codec.encodeToString(schema, { createdAt: date });
      const parsed = JSON.parse(result);

      expect(parsed.createdAt).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should encode bigint to string in JSON", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        bigNumber: t.bigint(),
      });

      const result = alepha.codec.encodeToString(schema, {
        bigNumber: 9007199254740991n,
      });
      const parsed = JSON.parse(result);

      expect(parsed.bigNumber).toBe("9007199254740991");
    });

    it("should encode URL to string in JSON", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        website: t.url(),
      });

      const result = alepha.codec.encodeToString(schema, {
        website: new URL("https://example.com/path"),
      });
      const parsed = JSON.parse(result);

      expect(parsed.website).toBe("https://example.com/path");
    });

    it("should encode binary to base64 string in JSON", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        data: t.binary({}),
      });

      const result = alepha.codec.encodeToString(schema, {
        data: new Uint8Array([104, 101, 108, 108, 111]),
      });
      const parsed = JSON.parse(result);

      expect(parsed.data).toBe("aGVsbG8=");
    });

    it("should encode mixed codec types to JSON", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        createdAt: t.datetime(),
        birthDate: t.date(),
        website: t.url(),
        count: t.bigint(),
      });

      const data = {
        id: 1,
        createdAt: new Date("2024-01-01T12:00:00.000Z"),
        birthDate: new Date("1990-05-15T00:00:00.000Z"),
        website: new URL("https://example.com"),
        count: 999n,
      };

      const result = alepha.codec.encodeToString(schema, data);
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe(1);
      expect(parsed.createdAt).toBe("2024-01-01T12:00:00.000Z");
      expect(parsed.birthDate).toBe("1990-05-15");
      expect(parsed.website).toBe("https://example.com/");
      expect(parsed.count).toBe("999");
    });
  });

  describe("decode - round trip with encode", () => {
    it("should decode what was encoded (simple object)", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string(),
      });

      const original = { id: 1, name: "John" };
      const encoded = alepha.codec.encode(schema, original);
      const decoded = alepha.codec.decode(schema, encoded);

      expect(decoded).toStrictEqual(original);
    });

    it("should decode what was encoded (nested object)", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        user: t.object({
          name: t.string(),
          email: t.string(),
        }),
      });

      const original = {
        id: 1,
        user: {
          name: "John",
          email: "john@example.com",
        },
      };

      const encoded = alepha.codec.encode(schema, original);
      const decoded = alepha.codec.decode(schema, encoded);

      expect(decoded).toStrictEqual(original);
    });

    it("should decode what was encoded (array of objects)", () => {
      const alepha = Alepha.create();
      const schema = t.array(
        t.object({
          id: t.number(),
          tags: t.array(t.string()),
        }),
      );

      const original = [
        { id: 1, tags: ["a", "b"] },
        { id: 2, tags: ["c", "d"] },
      ];

      const encoded = alepha.codec.encode(schema, original);
      const decoded = alepha.codec.decode(schema, encoded);

      expect(decoded).toStrictEqual(original);
    });

    it("should round-trip datetime codec", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        createdAt: t.datetime(),
      });

      const original = { createdAt: new Date("2024-01-01T00:00:00.000Z") };
      const encoded = alepha.codec.encode(schema, original);

      // After encode, it should be a string
      expect(typeof encoded.createdAt).toBe("string");

      const decoded = alepha.codec.decode(schema, encoded);

      // After decode, it should be a Date again
      expect(decoded.createdAt).toBeInstanceOf(Date);
      expect(decoded.createdAt.toISOString()).toBe(
        original.createdAt.toISOString(),
      );
    });

    it("should round-trip date codec", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        birthDate: t.date(),
      });

      const original = { birthDate: new Date("2024-01-15T00:00:00.000Z") };
      const encoded = alepha.codec.encode(schema, original);

      // After encode, it should be a string
      expect(typeof encoded.birthDate).toBe("string");
      expect(encoded.birthDate).toBe("2024-01-15");

      const decoded = alepha.codec.decode(schema, encoded);

      // After decode, it should be a Date again
      expect(decoded.birthDate).toBeInstanceOf(Date);
    });

    it("should round-trip url codec", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        website: t.url(),
      });

      const original = { website: new URL("https://example.com/path") };
      const encoded = alepha.codec.encode(schema, original);

      // After encode, it should be a string
      expect(typeof encoded.website).toBe("string");

      const decoded = alepha.codec.decode(schema, encoded);

      // After decode, it should be a URL again
      expect(decoded.website).toBeInstanceOf(URL);
      expect(decoded.website.toString()).toBe(original.website.toString());
    });

    it("should round-trip binary codec", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        data: t.binary({}),
      });

      const original = { data: new Uint8Array([1, 2, 3, 4, 5]) };
      const encoded = alepha.codec.encode(schema, original);

      // After encode, it should be a string
      expect(typeof encoded.data).toBe("string");

      const decoded = alepha.codec.decode(schema, encoded);

      // After decode, it should be a Uint8Array again
      expect(decoded.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(decoded.data)).toStrictEqual(Array.from(original.data));
    });

    it("should round-trip bigint codec", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        largeNumber: t.bigint(),
      });

      const original = { largeNumber: 9007199254740991n };
      const encoded = alepha.codec.encode(schema, original);

      // After encode, it should be a string
      expect(typeof encoded.largeNumber).toBe("string");

      const decoded = alepha.codec.decode(schema, encoded);

      // After decode, it should be a bigint again
      expect(typeof decoded.largeNumber).toBe("bigint");
      expect(decoded.largeNumber).toBe(original.largeNumber);
    });

    it("should round-trip complex object with multiple codec types", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        createdAt: t.datetime(),
        website: t.url(),
        count: t.bigint(),
        data: t.binary({}),
      });

      const original = {
        id: 1,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        website: new URL("https://example.com"),
        count: 12345n,
        data: new Uint8Array([10, 20, 30]),
      };

      const encoded = alepha.codec.encode(schema, original);

      // Check encoded types
      expect(typeof encoded.createdAt).toBe("string");
      expect(typeof encoded.website).toBe("string");
      expect(typeof encoded.count).toBe("string");
      expect(typeof encoded.data).toBe("string");

      const decoded = alepha.codec.decode(schema, encoded);

      // Check decoded types
      expect(decoded.id).toBe(original.id);
      expect(decoded.createdAt).toBeInstanceOf(Date);
      expect(decoded.website).toBeInstanceOf(URL);
      expect(typeof decoded.count).toBe("bigint");
      expect(decoded.data).toBeInstanceOf(Uint8Array);

      // Check values
      expect(decoded.createdAt.toISOString()).toBe(
        original.createdAt.toISOString(),
      );
      expect(decoded.website.toString()).toBe(original.website.toString());
      expect(decoded.count).toBe(original.count);
      expect(Array.from(decoded.data)).toStrictEqual(Array.from(original.data));
    });
  });

  describe("decode - edge cases", () => {
    it("should handle null conversion to undefined for optional fields", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.optional(t.string()),
      });

      // SchemaCodec.nullToUndefined should convert null to undefined for optional fields
      const result = alepha.codec.decode(schema, { id: 1, name: null });
      expect(result).toStrictEqual({ id: 1 });
    });

    it("should handle empty strings", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        name: t.string(),
      });

      expect(alepha.codec.decode(schema, { name: "" })).toStrictEqual({
        name: "",
      });
    });

    it("should handle zero values", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        count: t.number(),
      });

      expect(alepha.codec.decode(schema, { count: 0 })).toStrictEqual({
        count: 0,
      });
    });

    it("should handle false boolean values", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        active: t.boolean(),
      });

      expect(alepha.codec.decode(schema, { active: false })).toStrictEqual({
        active: false,
      });
    });

    it("should handle negative numbers", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        balance: t.number(),
      });

      expect(alepha.codec.decode(schema, { balance: -100 })).toStrictEqual({
        balance: -100,
      });
    });
  });

  describe("decode - complex real-world scenarios", () => {
    it("should decode API response with pagination", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        data: t.array(
          t.object({
            id: t.number(),
            name: t.string(),
            email: t.string(),
          }),
        ),
        pagination: t.object({
          total: t.number(),
          page: t.number(),
          perPage: t.number(),
        }),
      });

      const response = {
        data: [
          { id: 1, name: "John", email: "john@example.com" },
          { id: 2, name: "Jane", email: "jane@example.com" },
        ],
        pagination: {
          total: 100,
          page: 1,
          perPage: 10,
        },
      };

      expect(alepha.codec.decode(schema, response)).toStrictEqual(response);
    });

    it("should decode user profile with nested preferences", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        username: t.string(),
        profile: t.object({
          firstName: t.string(),
          lastName: t.string(),
          bio: t.optional(t.string()),
        }),
        preferences: t.object({
          theme: t.enum(["light", "dark"]),
          notifications: t.object({
            email: t.boolean(),
            push: t.boolean(),
          }),
        }),
        roles: t.array(t.string()),
      });

      const user = {
        id: 1,
        username: "johndoe",
        profile: {
          firstName: "John",
          lastName: "Doe",
          bio: "Software developer",
        },
        preferences: {
          theme: "dark",
          notifications: {
            email: true,
            push: false,
          },
        },
        roles: ["user", "admin"],
      };

      expect(alepha.codec.decode(schema, user)).toStrictEqual(user);
    });

    it("should decode e-commerce order", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        orderId: t.string(),
        customerId: t.number(),
        items: t.array(
          t.object({
            productId: t.number(),
            name: t.string(),
            quantity: t.number(),
            price: t.number(),
          }),
        ),
        total: t.number(),
        status: t.enum(["pending", "processing", "shipped", "delivered"]),
        shippingAddress: t.object({
          street: t.string(),
          city: t.string(),
          zipCode: t.string(),
          country: t.string(),
        }),
        createdAt: t.string(),
      });

      const order = {
        orderId: "ORD-12345",
        customerId: 42,
        items: [
          {
            productId: 1,
            name: "Product A",
            quantity: 2,
            price: 29.99,
          },
          {
            productId: 2,
            name: "Product B",
            quantity: 1,
            price: 49.99,
          },
        ],
        total: 109.97,
        status: "processing",
        shippingAddress: {
          street: "123 Main St",
          city: "New York",
          zipCode: "10001",
          country: "USA",
        },
        createdAt: "2024-01-01T12:00:00Z",
      };

      expect(alepha.codec.decode(schema, order)).toStrictEqual(order);
    });

    it("should decode blog post with comments", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        title: t.string(),
        content: t.string(),
        author: t.object({
          id: t.number(),
          name: t.string(),
        }),
        tags: t.array(t.string()),
        comments: t.array(
          t.object({
            id: t.number(),
            author: t.string(),
            text: t.string(),
            createdAt: t.string(),
          }),
        ),
        metadata: t.record(t.string(), t.string()),
      });

      const post = {
        id: 1,
        title: "Getting Started with TypeScript",
        content: "Lorem ipsum...",
        author: {
          id: 42,
          name: "John Doe",
        },
        tags: ["typescript", "programming", "tutorial"],
        comments: [
          {
            id: 1,
            author: "Jane",
            text: "Great article!",
            createdAt: "2024-01-01T10:00:00Z",
          },
          {
            id: 2,
            author: "Bob",
            text: "Very helpful, thanks!",
            createdAt: "2024-01-01T11:00:00Z",
          },
        ],
        metadata: {
          views: "1234",
          likes: "56",
        },
      };

      expect(alepha.codec.decode(schema, post)).toStrictEqual(post);
    });
  });

  describe("encode - complex real-world scenarios", () => {
    it("should encode and serialize API request", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        query: t.string(),
        filters: t.object({
          status: t.array(t.string()),
          dateRange: t.object({
            start: t.datetime(),
            end: t.datetime(),
          }),
        }),
        pagination: t.object({
          page: t.number(),
          limit: t.number(),
        }),
      });

      const request = {
        query: "search term",
        filters: {
          status: ["active", "pending"],
          dateRange: {
            start: new Date("2024-01-01"),
            end: new Date("2024-12-31"),
          },
        },
        pagination: {
          page: 1,
          limit: 20,
        },
      };

      const encoded = alepha.codec.encode(schema, request);
      expect(encoded.query).toBe("search term");
      expect(encoded.filters.status).toStrictEqual(["active", "pending"]);
      expect(typeof encoded.filters.dateRange.start).toBe("string");
      expect(typeof encoded.filters.dateRange.end).toBe("string");
    });

    it("should encode form data with validation", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        username: t.string({ minLength: 3 }),
        email: t.text({ format: "email" }),
        password: t.string({ minLength: 8 }),
        agreedToTerms: t.boolean(),
        preferences: t.optional(
          t.object({
            newsletter: t.boolean(),
          }),
        ),
      });

      const formData = {
        username: "johndoe",
        email: "john@example.com",
        password: "securepassword123",
        agreedToTerms: true,
        preferences: {
          newsletter: true,
        },
      };

      const encoded = alepha.codec.encode(schema, formData);
      expect(encoded).toStrictEqual(formData);
    });
  });

  describe("encodeToString - real-world JSON serialization", () => {
    it("should serialize API response to JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        success: t.boolean(),
        data: t.object({
          id: t.number(),
          name: t.string(),
        }),
        timestamp: t.datetime(),
      });

      const response = {
        success: true,
        data: {
          id: 1,
          name: "Test",
        },
        timestamp: new Date("2024-01-01T00:00:00.000Z"),
      };

      const json = alepha.codec.encodeToString(schema, response);
      const parsed = JSON.parse(json);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toStrictEqual({ id: 1, name: "Test" });
      expect(parsed.timestamp).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should serialize complex nested data structure", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        users: t.array(
          t.object({
            id: t.number(),
            metadata: t.record(t.string(), t.any()),
          }),
        ),
      });

      const data = {
        users: [
          {
            id: 1,
            metadata: {
              lastLogin: "2024-01-01",
              preferences: { theme: "dark" },
            },
          },
        ],
      };

      const json = alepha.codec.encodeToString(schema, data);
      expect(JSON.parse(json)).toStrictEqual(data);
    });
  });

  describe("decode - from JSON string", () => {
    it("should decode from JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        name: t.string(),
      });

      const jsonString = '{"id":1,"name":"John"}';
      const decoded = alepha.codec.decode(schema, jsonString);

      expect(decoded).toStrictEqual({ id: 1, name: "John" });
    });

    it("should decode complex object from JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        id: t.number(),
        items: t.array(
          t.object({
            name: t.string(),
            quantity: t.number(),
          }),
        ),
      });

      const jsonString = '{"id":1,"items":[{"name":"Item1","quantity":5}]}';
      const decoded = alepha.codec.decode(schema, jsonString);

      expect(decoded).toStrictEqual({
        id: 1,
        items: [{ name: "Item1", quantity: 5 }],
      });
    });

    it("should decode array from JSON string", () => {
      const alepha = Alepha.create();
      const schema = t.array(t.number());

      const jsonString = "[1,2,3,4,5]";
      const decoded = alepha.codec.decode(schema, jsonString);

      expect(decoded).toStrictEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("decode - text size variants", () => {
    it("should decode short text", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        title: t.shortText(),
      });

      expect(
        alepha.codec.decode(schema, { title: "Short Title" }),
      ).toStrictEqual({
        title: "Short Title",
      });
    });

    it("should decode long text", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        description: t.longText(),
      });

      const longDescription = "A".repeat(500);
      expect(
        alepha.codec.decode(schema, { description: longDescription }),
      ).toStrictEqual({
        description: longDescription,
      });
    });

    it("should decode rich text", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        content: t.richText(),
      });

      const htmlContent =
        "<html><body><h1>Title</h1><p>Content goes here</p></body></html>";
      expect(
        alepha.codec.decode(schema, { content: htmlContent }),
      ).toStrictEqual({
        content: htmlContent,
      });
    });

    it("should decode text with explicit size option", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        name: t.text({ size: "short" }),
        bio: t.text({ size: "long" }),
        article: t.text({ size: "rich" }),
      });

      expect(
        alepha.codec.decode(schema, {
          name: "John",
          bio: "Software developer",
          article: "<p>Long article content</p>",
        }),
      ).toStrictEqual({
        name: "John",
        bio: "Software developer",
        article: "<p>Long article content</p>",
      });
    });
  });

  describe("decode - nullable types", () => {
    it("should decode nullable string", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        name: t.nullable(t.string()),
      });

      expect(alepha.codec.decode(schema, { name: "John" })).toStrictEqual({
        name: "John",
      });

      expect(alepha.codec.decode(schema, { name: null })).toStrictEqual({
        name: null,
      });
    });

    it("should decode nullable object", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        user: t.nullable(
          t.object({
            name: t.string(),
          }),
        ),
      });

      expect(
        alepha.codec.decode(schema, { user: { name: "John" } }),
      ).toStrictEqual({
        user: { name: "John" },
      });

      expect(alepha.codec.decode(schema, { user: null })).toStrictEqual({
        user: null,
      });
    });

    it("should decode nullable array", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        tags: t.nullable(t.array(t.string())),
      });

      expect(
        alepha.codec.decode(schema, { tags: ["a", "b", "c"] }),
      ).toStrictEqual({
        tags: ["a", "b", "c"],
      });

      expect(alepha.codec.decode(schema, { tags: null })).toStrictEqual({
        tags: null,
      });
    });
  });

  describe("encode - text size variants", () => {
    it("should encode short text", () => {
      const alepha = Alepha.create();
      const schema = t.shortText();

      expect(alepha.codec.encode(schema, "Title")).toBe("Title");
    });

    it("should encode long text", () => {
      const alepha = Alepha.create();
      const schema = t.longText();

      const longText = "A".repeat(500);
      expect(alepha.codec.encode(schema, longText)).toBe(longText);
    });

    it("should encode rich text", () => {
      const alepha = Alepha.create();
      const schema = t.richText();

      const html = "<h1>Title</h1><p>Content</p>";
      expect(alepha.codec.encode(schema, html)).toBe(html);
    });
  });

  describe("encode - nullable types", () => {
    it("should encode nullable string", () => {
      const alepha = Alepha.create();
      const schema = t.nullable(t.string());

      expect(alepha.codec.encode(schema, "hello")).toBe("hello");
      expect(alepha.codec.encode(schema, null)).toBe(null);
    });

    it("should encode nullable object", () => {
      const alepha = Alepha.create();
      const schema = t.nullable(
        t.object({
          name: t.string(),
        }),
      );

      expect(alepha.codec.encode(schema, { name: "John" })).toStrictEqual({
        name: "John",
      });
      expect(alepha.codec.encode(schema, null)).toBe(null);
    });
  });

  describe("decode - int64 type", () => {
    it("should decode int64 as number", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        count: t.int64(),
      });

      expect(
        alepha.codec.decode(schema, { count: 9007199254740991 }),
      ).toStrictEqual({
        count: 9007199254740991,
      });
    });

    it("should decode negative int64", () => {
      const alepha = Alepha.create();
      const schema = t.object({
        balance: t.int64(),
      });

      expect(
        alepha.codec.decode(schema, { balance: -9007199254740991 }),
      ).toStrictEqual({
        balance: -9007199254740991,
      });
    });
  });

  describe("encode - int64 type", () => {
    it("should encode int64", () => {
      const alepha = Alepha.create();
      const schema = t.int64();

      expect(alepha.codec.encode(schema, 9007199254740991)).toBe(
        9007199254740991,
      );
    });

    it("should encode negative int64", () => {
      const alepha = Alepha.create();
      const schema = t.int64();

      expect(alepha.codec.encode(schema, -9007199254740991)).toBe(
        -9007199254740991,
      );
    });
  });

  describe("decode - partial and pick types", () => {
    it("should decode partial type", () => {
      const alepha = Alepha.create();
      const baseSchema = t.object({
        id: t.number(),
        name: t.string(),
        email: t.string(),
      });
      const schema = t.partial(baseSchema);

      expect(alepha.codec.decode(schema, { id: 1 })).toStrictEqual({ id: 1 });
      expect(
        alepha.codec.decode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({
        id: 1,
        name: "John",
      });
    });

    it("should decode picked type", () => {
      const alepha = Alepha.create();
      const baseSchema = t.object({
        id: t.number(),
        name: t.string(),
        email: t.string(),
        age: t.number(),
      });
      const schema = t.pick(baseSchema, ["id", "name"]);

      expect(
        alepha.codec.decode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({
        id: 1,
        name: "John",
      });
    });

    it("should decode omitted type", () => {
      const alepha = Alepha.create();
      const baseSchema = t.object({
        id: t.number(),
        name: t.string(),
        password: t.string(),
      });
      const schema = t.omit(baseSchema, ["password"]);

      expect(
        alepha.codec.decode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({
        id: 1,
        name: "John",
      });
    });
  });

  describe("encode - partial and pick types", () => {
    it("should encode partial type", () => {
      const alepha = Alepha.create();
      const baseSchema = t.object({
        id: t.number(),
        name: t.string(),
      });
      const schema = t.partial(baseSchema);

      expect(alepha.codec.encode(schema, { id: 1 })).toStrictEqual({ id: 1 });
    });

    it("should encode picked type", () => {
      const alepha = Alepha.create();
      const baseSchema = t.object({
        id: t.number(),
        name: t.string(),
        email: t.string(),
      });
      const schema = t.pick(baseSchema, ["id", "name"]);

      expect(
        alepha.codec.encode(schema, { id: 1, name: "John" }),
      ).toStrictEqual({
        id: 1,
        name: "John",
      });
    });
  });

  describe("decode - tuple types", () => {
    it("should decode tuple with mixed types", () => {
      const alepha = Alepha.create();
      const schema = t.tuple([t.number(), t.string(), t.boolean()]);

      expect(alepha.codec.decode(schema, [1, "hello", true])).toStrictEqual([
        1,
        "hello",
        true,
      ]);
    });

    it("should decode tuple with objects", () => {
      const alepha = Alepha.create();
      const schema = t.tuple([
        t.object({ id: t.number() }),
        t.object({ name: t.string() }),
      ]);

      expect(
        alepha.codec.decode(schema, [{ id: 1 }, { name: "John" }]),
      ).toStrictEqual([{ id: 1 }, { name: "John" }]);
    });
  });

  describe("encode - tuple types", () => {
    it("should encode tuple with mixed types", () => {
      const alepha = Alepha.create();
      const schema = t.tuple([t.number(), t.string(), t.boolean()]);

      expect(alepha.codec.encode(schema, [42, "test", false])).toStrictEqual([
        42,
        "test",
        false,
      ]);
    });

    it("should encode tuple with codec types", () => {
      const alepha = Alepha.create();
      const schema = t.tuple([t.datetime(), t.bigint()]);

      const encoded = alepha.codec.encode(schema, [
        new Date("2024-01-01T00:00:00.000Z"),
        123n,
      ]);

      expect(typeof encoded[0]).toBe("string");
      expect(typeof encoded[1]).toBe("string");
      expect(encoded[0]).toBe("2024-01-01T00:00:00.000Z");
      expect(encoded[1]).toBe("123");
    });
  });

  describe("performance - schema caching", () => {
    it("should reuse validator for same schema", () => {
      const alepha = Alepha.create();
      const schema = t.object({ id: t.number() });

      // First decode
      alepha.codec.decode(schema, { id: 1 });

      // Second decode should use cached validator
      const result = alepha.codec.decode(schema, { id: 2 });

      expect(result).toStrictEqual({ id: 2 });
    });

    it("should handle multiple schemas with caching", () => {
      const alepha = Alepha.create();
      const schema1 = t.object({ id: t.number() });
      const schema2 = t.object({ name: t.string() });

      alepha.codec.decode(schema1, { id: 1 });
      alepha.codec.decode(schema2, { name: "test" });
      alepha.codec.decode(schema1, { id: 2 });

      // Both schemas should be cached and work correctly
      expect(alepha.codec.decode(schema1, { id: 3 })).toStrictEqual({ id: 3 });
      expect(alepha.codec.decode(schema2, { name: "test2" })).toStrictEqual({
        name: "test2",
      });
    });
  });
});
