import { describe, it } from "vitest";
import { z as classic } from "zod";

import { z } from "../providers/ZodProvider.ts";

/**
 * Classic zod members `zodChain.ts` deliberately leaves out.
 *
 * `z` is typed as classic zod, so each of these compiles and then throws "is not
 * a function". Nothing in the repository calls one. Adding a name here accepts
 * that for a new member; a zod upgrade that adds one fails the first test below.
 */
const LEFT_OUT = [
  "base64",
  "base64url",
  "cidrv4",
  "cidrv6",
  "cuid",
  "cuid2",
  "date",
  "datetime",
  "decode",
  "decodeAsync",
  "duration",
  "e164",
  "email",
  "emoji",
  "encode",
  "encodeAsync",
  "exactOptional",
  "exactPartial",
  "guid",
  "ipv4",
  "ipv6",
  "isFinite",
  "isInt",
  "isNullable",
  "isOptional",
  "jwt",
  "keyType",
  "ksuid",
  "lowercase",
  "nanoid",
  "nonoptional",
  "normalize",
  "overwrite",
  "removeDefault",
  "rest",
  "safe",
  "safeDecode",
  "safeDecodeAsync",
  "safeEncode",
  "safeEncodeAsync",
  "slugify",
  "spa",
  "step",
  "strip",
  "time",
  "toJSONSchema",
  "ulid",
  "uppercase",
  "url",
  "uuid",
  "uuidv4",
  "uuidv6",
  "uuidv7",
  "validate",
  "validateAsync",
  "valueType",
  "xid",
];

const members = (schema: object): Set<string> => {
  const out = new Set<string>();
  for (
    let proto = schema;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      out.add(name);
    }
  }
  return out;
};

const fn = (value: unknown) => value;

const pairs: Record<string, [object, object]> = {
  string: [classic.string(), z.string()],
  email: [classic.email(), z.email()],
  url: [classic.url(), z.url()],
  uuid: [classic.guid(), z.uuid()],
  number: [classic.number(), z.number()],
  integer: [classic.int(), z.integer()],
  boolean: [classic.boolean(), z.boolean()],
  any: [classic.any(), z.any()],
  object: [
    classic.object({ a: classic.string() }),
    z.object({ a: z.string() }),
  ],
  array: [classic.array(classic.string()), z.array(z.string())],
  record: [
    classic.record(classic.string(), classic.any()),
    z.record(z.string(), z.any()),
  ],
  union: [
    classic.union([classic.string(), classic.number()]),
    z.union([z.string(), z.number()]),
  ],
  enum: [classic.enum(["a"]), z.enum(["a"])],
  literal: [classic.literal("a"), z.literal("a")],
  tuple: [classic.tuple([classic.string()]), z.tuple([z.string()])],
  optional: [classic.string().optional(), z.string().optional()],
  nullable: [classic.string().nullable(), z.string().nullable()],
  default: [classic.string().default("a"), z.string().default("a")],
  isoDate: [classic.iso.date(), z.date()],
  isoDatetime: [classic.iso.datetime(), z.datetime()],
  isoTime: [classic.iso.time(), z.time()],
  custom: [classic.custom(), z.custom()],
  pipe: [classic.string().transform(fn), z.string().transform(fn)],
  intersection: [
    classic.string().and(classic.string()),
    z.string().and(z.string()),
  ],
  readonly: [classic.string().readonly(), z.string().readonly()],
  coerceBigint: [classic.coerce.bigint(), z.coerce.bigint()],
};

describe("zodChain", () => {
  it("provides every classic member except the frozen list", ({ expect }) => {
    const missing = new Set<string>();
    for (const [classicSchema, schema] of Object.values(pairs)) {
      const have = members(schema);
      for (const name of members(classicSchema)) {
        if (
          name === "constructor" ||
          name.startsWith("_") ||
          name === "~standard"
        ) {
          continue;
        }
        if (!have.has(name)) {
          missing.add(name);
        }
      }
    }

    expect([...missing].sort()).toEqual(LEFT_OUT);
  });

  it("keeps a schema's checks through strict and loose", ({ expect }) => {
    const base = z.object({ a: z.string() }).refine((v) => v.a !== "no");

    expect(base.strict().safeParse({ a: "no" }).success).toBe(false);
    expect(base.strict().safeParse({ a: "yes", b: 1 }).success).toBe(false);
    expect(base.loose().parse({ a: "yes", b: 1 })).toEqual({ a: "yes", b: 1 });
  });

  it("reads the tightest bound a schema declares", ({ expect }) => {
    const number = z.number().min(1).min(3).max(9).max(7) as any;
    const text = z.string().min(2).max(8) as any;

    expect([number.minValue, number.maxValue]).toEqual([3, 7]);
    expect([text.minLength, text.maxLength]).toEqual([2, 8]);
  });

  it("does not bind the chain onto each schema", ({ expect }) => {
    expect(Object.hasOwn(z.string(), "optional")).toBe(false);
  });

  it("exports JSON Schema from the namespace", ({ expect }) => {
    const schema = z.object({ a: z.text({ size: "short" }) });

    expect(z.toJSONSchema(schema).properties?.a).toEqual({
      type: "string",
      maxLength: 64,
    });
  });
});
