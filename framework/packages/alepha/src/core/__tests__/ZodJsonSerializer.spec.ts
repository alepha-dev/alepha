import { describe, it } from "vitest";

import { ZodJsonSerializer } from "../helpers/ZodJsonSerializer.ts";
import { z } from "../index.ts";

/**
 * The serializer must write exactly what the parse-then-stringify path wrote,
 * for every value that parse accepts, and decline (answer `undefined`) for
 * every value whose TYPES parse rejects. Only constraint checks may differ:
 * a value failing one is written as it is.
 */
/**
 * The closures alone, as where eval is refused (workerd, the browser).
 */
class InterpretedSerializer extends ZodJsonSerializer {
  protected override compileObject(): undefined {
    return undefined;
  }
}

const serializers: Array<[string, ZodJsonSerializer]> = [
  ["compiled", new ZodJsonSerializer()],
  ["interpreted", new InterpretedSerializer()],
];

const user = z.object({
  id: z.integer(),
  name: z.text(),
  email: z.email(),
  age: z.integer().optional(),
  role: z.enum(["admin", "user"]).default("user"),
  tags: z.array(z.text({ lowercase: true })),
  bio: z.text().nullable().optional(),
  meta: z.json().optional(),
});

const cases: Array<[string, unknown, unknown[]]> = [
  ["text", z.text(), ["a", "  padded  ", "", 'quote " and \\ and \n', 3, null]],
  ["lowercase text", z.text({ lowercase: true }), [" MiXeD ", 1]],
  [
    "integer",
    z.integer(),
    [0, -0, 42, 1.5, Number.NaN, Infinity, "1", 2 ** 53],
  ],
  ["number", z.number(), [1.5, -2e-7, 1e21, Number.NaN, "x"]],
  ["boolean", z.boolean(), [true, false, 0, "true"]],
  ["enum", z.enum(["a", "b"]), ["a", "c", 1]],
  ["literal", z.literal("x"), ["x", "y"]],
  ["uuid", z.uuid(), ["123e4567-e89b-12d3-a456-426614174000", 7]],
  ["datetime", z.datetime(), ["2026-11-06T10:00:00.000Z", 1]],
  ["date", z.date(), ["2026-11-06", {}]],
  ["nullable", z.text().nullable(), [null, "a", undefined, 1]],
  ["optional", z.text().optional(), [undefined, "a", null]],
  ["default", z.integer().default(3), [undefined, 7, "7"]],
  ["array", z.array(z.integer()), [[], [1, 2], [1, "2"], "x", null]],
  [
    "array of optional",
    z.array(z.text().optional()),
    [["a", undefined, "b"], [1]],
  ],
  ["json record", z.json(), [{}, { a: 1, b: [true, null], c: "x" }, [], null]],
  ["record", z.record(z.string(), z.integer()), [{ a: 1, b: 2 }, { a: "1" }]],
  [
    "object",
    user,
    [
      {
        id: 1,
        name: "  Ada  ",
        email: "ada@example.com",
        tags: ["X", " Y "],
      },
      {
        id: 2,
        name: "Bob",
        email: "bob@example.com",
        age: 30,
        role: "admin",
        tags: [],
        bio: null,
        meta: { theme: "dark" },
        password: "secret",
      },
      { id: 3, name: "Cy", email: "c@example.com", tags: [], bio: undefined },
      { id: "4", name: "D", email: "d@example.com", tags: [] },
      { id: 5, name: "E", email: "e@example.com" },
      { id: 6, name: "F", email: "f@example.com", tags: [], role: "root" },
      [],
      null,
      "x",
    ],
  ],
  [
    "list of objects",
    z.array(
      z.object({
        id: z.integer(),
        name: z.text(),
        nested: z.object({ ok: z.boolean() }),
      }),
    ),
    [
      [
        { id: 1, name: "a", nested: { ok: true }, extra: 1 },
        { id: 2, name: " b ", nested: { ok: false } },
      ],
      [{ id: 1, name: "a", nested: { ok: "yes" } }],
    ],
  ],
];

for (const [mode, serializer] of serializers) {
  describe(`ZodJsonSerializer, ${mode}`, () => {
    for (const [name, schema, values] of cases) {
      describe(`${name}`, () => {
        it("has a writer", ({ expect }) => {
          expect(serializer.supports(schema)).toBe(true);
        });

        for (const value of values) {
          it(`writes ${JSON.stringify(value) ?? "undefined"} as parse-then-stringify does, or declines`, ({
            expect,
          }) => {
            const parsed = (schema as any).safeParse(value);
            const written = serializer.serialize(schema, value);
            if (parsed.success) {
              expect(written).toBe(JSON.stringify(parsed.data));
            } else {
              const typeIssue = parsed.error.issues.some((issue: any) =>
                ["invalid_type", "invalid_value", "invalid_union"].includes(
                  issue.code,
                ),
              );
              if (typeIssue) {
                expect(written).toBeUndefined();
              }
            }
          });
        }
      });
    }

    describe("constraint checks", () => {
      it("writes a value that fails only a check, as it is", ({ expect }) => {
        const long = "x".repeat(300);

        expect(z.text().safeParse(long).success).toBe(false);
        expect(serializer.serialize(z.text(), long)).toBe(JSON.stringify(long));
        expect(serializer.serialize(z.email(), "not an email")).toBe(
          '"not an email"',
        );
        expect(serializer.serialize(z.int32(), 2 ** 40)).toBe(String(2 ** 40));
      });
    });

    describe("refused schemas", () => {
      const refused: Array<[string, unknown]> = [
        ["union", z.union([z.text(), z.integer()])],
        ["strict object", (z.object({ a: z.text() }) as any).strict()],
        [
          "transform",
          (z.text() as any).transform?.((value: string) => value.length) ??
            z.union([z.text(), z.integer()]),
        ],
        [
          "object holding a union",
          z.object({ a: z.union([z.text(), z.integer()]) }),
        ],
      ];
      for (const [name, schema] of refused) {
        it(`has no writer for a ${name}`, ({ expect }) => {
          expect(serializer.supports(schema)).toBe(false);
          expect(serializer.serialize(schema, { a: "x" })).toBeUndefined();
        });
      }
    });
  });
}
