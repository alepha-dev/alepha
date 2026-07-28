import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { KeylessJsonSchemaCodec } from "../providers/KeylessJsonSchemaCodec.ts";

/**
 * `z.bigint()` is a `ZodString` carrying `format: "bigint"` — the framework
 * represents big integers as decimal strings end to end (the ORM stores
 * non-key bigint columns as TEXT for the same reason). The codec still
 * contained a typebox-era design where bigints were encoded with an `"n"`
 * suffix and decoded via `BigInt(v.slice(0, -1))`.
 *
 * Every one of those branches sits behind an `isLeaf()` early return, and
 * `isLeaf` is true for a bigint (it is a scalar) — so none of them ran and the
 * round-trip worked by accident. These tests pin the string behaviour so the
 * dead branches can be removed without changing anything observable, and so a
 * future "fix" that reinstates suffix decoding fails loudly: slicing a string
 * that has no suffix silently drops its last digit.
 */
const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const codec = alepha.inject(KeylessJsonSchemaCodec);
  await alepha.start();
  return codec;
};

const roundTrip = (codec: KeylessJsonSchemaCodec, schema: any, value: any) =>
  codec.decode(schema, JSON.parse(codec.encodeToString(schema, value)));

describe("keyless codec — bigint is a decimal string", () => {
  it("round-trips a top-level bigint field unchanged", async () => {
    const codec = await setup();
    const schema = z.object({ big: z.bigint() });

    expect(codec.encodeToString(schema, { big: "123" } as never)).toBe(
      '["123"]',
    );
    expect(roundTrip(codec, schema, { big: "123" })).toEqual({ big: "123" });
  });

  it("preserves precision beyond 2^53", async () => {
    const codec = await setup();
    const schema = z.object({ big: z.bigint() });
    const huge = "9007199254740993123456789";

    expect(roundTrip(codec, schema, { big: huge })).toEqual({ big: huge });
  });

  it("round-trips a bigint nested inside an object", async () => {
    const codec = await setup();
    const schema = z.object({
      wrapper: z.object({ big: z.bigint(), label: z.text() }),
    });
    const value = { wrapper: { big: "42", label: "x" } };

    expect(roundTrip(codec, schema, value)).toEqual(value);
  });

  it("round-trips an array of bigints", async () => {
    const codec = await setup();
    const schema = z.object({ bigs: z.array(z.bigint()) });
    const value = { bigs: ["1", "22", "333"] };

    expect(roundTrip(codec, schema, value)).toEqual(value);
  });

  it("round-trips an array of objects carrying bigints", async () => {
    const codec = await setup();
    const schema = z.object({
      rows: z.array(z.object({ big: z.bigint(), n: z.integer() })),
    });
    const value = {
      rows: [
        { big: "10", n: 1 },
        { big: "20", n: 2 },
      ],
    };

    expect(roundTrip(codec, schema, value)).toEqual(value);
  });

  it("round-trips an optional bigint that is present", async () => {
    const codec = await setup();
    const schema = z.object({ big: z.bigint().optional() });

    expect(roundTrip(codec, schema, { big: "7" })).toEqual({ big: "7" });
  });

  it("treats a zod enum as a leaf without help from isEnum", async () => {
    const codec = await setup();
    const schema = z.object({ kind: z.enum(["a", "b"]) });

    expect(roundTrip(codec, schema, { kind: "b" })).toEqual({ kind: "b" });
  });
});
