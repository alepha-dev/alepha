import { describe, expect, test } from "vitest";

import { z } from "../providers/ZodProvider.ts";

/**
 * Count the zod schema nodes `build` constructs. zod calls
 * `__zod_globalConfig.postProcessor` after building every instance; a schema
 * has `_zod.def.type`, a check does not.
 */
const countNodes = (build: () => unknown): number => {
  const cfg = ((globalThis as any).__zod_globalConfig ??= {});
  const previous = cfg.postProcessor;
  let n = 0;
  cfg.postProcessor = (inst: any) => {
    if (inst?._zod?.def?.type) n++;
    previous?.(inst);
  };
  try {
    build();
  } finally {
    cfg.postProcessor = previous;
  }
  return n;
};

describe("z helpers build each schema once", () => {
  test("json schema parity", () => {
    expect(z.toJSONSchema(z.text())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "maxLength": 255,
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.shortText())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "maxLength": 64,
        "type": "string",
      }
    `);
    expect(
      z.toJSONSchema(z.text({ lowercase: true, minLength: 2, pattern: "^a" })),
    ).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "maxLength": 255,
        "minLength": 2,
        "pattern": "^a",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.text({ default: "x", title: "T" })))
      .toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "default": "x",
        "maxLength": 255,
        "title": "T",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.datetime())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.date())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "date",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.uuid())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "uuid",
        "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.email())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "email",
        "pattern": "^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.url())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "url",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.time())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "time",
        "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?$",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.bigint())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "bigint",
        "pattern": "^-?\\d+$",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.binary())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "binary",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.duration())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "duration",
        "type": "string",
      }
    `);
    expect(z.toJSONSchema(z.dateRange())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "date-range",
        "items": {
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$",
          "type": "string",
        },
        "maxItems": 2,
        "minItems": 2,
        "type": "array",
      }
    `);
    expect(z.toJSONSchema(z.int32())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "maximum": 2147483647,
        "minimum": -2147483648,
        "type": "integer",
      }
    `);
    expect(z.toJSONSchema(z.int64())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "int64",
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "type": "integer",
      }
    `);
    expect(z.toJSONSchema(z.file({ maxBytes: 10 }))).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "binary",
        "maxBytes": 10,
      }
    `);
    expect(z.toJSONSchema(z.stream())).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "format": "stream",
      }
    `);
  });

  test("metadata parity", () => {
    expect(z.schema.meta(z.text({ default: "x", title: "T" })))
      .toMatchInlineSnapshot(`
      {
        "maxLength": 255,
        "title": "T",
        "~options": {
          "lowercase": false,
          "trim": true,
        },
      }
    `);
    expect(z.schema.meta(z.datetime())).toMatchInlineSnapshot(`
      {
        "format": "date-time",
      }
    `);
    expect(z.schema.meta(z.int64())).toMatchInlineSnapshot(`
      {
        "format": "int64",
      }
    `);
    expect(z.schema.meta(z.file({ maxBytes: 10 }))).toMatchInlineSnapshot(`
      {
        "format": "binary",
        "maxBytes": 10,
      }
    `);
    expect(z.schema.meta(z.dateRange())).toMatchInlineSnapshot(`
      {
        "format": "date-range",
      }
    `);
  });

  test("check order is kept", () => {
    // max runs before trim: a padded value over the cap still fails.
    expect(z.text({ maxLength: 5 }).safeParse("  ab  ").success).toBe(false);
    expect(z.text({ maxLength: 5 }).parse(" ab ")).toBe("ab");
    expect(z.text({ lowercase: true }).parse(" AB ")).toBe("ab");
    expect(z.dateRange().safeParse(["2026-01-02", "2026-01-01"]).success).toBe(
      false,
    );
    expect(z.int32().safeParse(2147483648).success).toBe(false);
  });

  test("builds each helper once", () => {
    expect(countNodes(() => z.text())).toBe(2);
    expect(
      countNodes(() =>
        z.text({ lowercase: true, minLength: 2, pattern: "^a" }),
      ),
    ).toBe(2);
    expect(countNodes(() => z.text({ default: "x", title: "T" }))).toBe(3);
    expect(countNodes(() => z.datetime())).toBe(1);
    expect(countNodes(() => z.uuid())).toBe(1);
    expect(countNodes(() => z.email())).toBe(1);
    expect(countNodes(() => z.file())).toBe(1);
    expect(countNodes(() => z.int64())).toBe(2);
    expect(countNodes(() => z.int32())).toBe(2);
    // date, array, the array with its checks, and the refine, which zod
    // builds as a schema of its own.
    expect(countNodes(() => z.dateRange())).toBe(4);
    expect(countNodes(() => z.bigint())).toBe(2);
  });

  test("public meta still copies", () => {
    const base = z.string();
    const a = base.describe("a");
    expect(a).not.toBe(base);
    expect(z.schema.meta(base).description).toBeUndefined();
    expect(z.schema.meta(a).description).toBe("a");
  });
});
