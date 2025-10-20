import { describe, expect, it } from "vitest";
import { Alepha, t } from "../src";

const model = t.object({
  id: t.text(),
  date: t.datetime(),
});

describe("Alepha#parse", () => {
  it("should parse objects with datetime fields", () => {
    const app = Alepha.create();
    const now = new Date();

    expect(
      app.parse(model, {
        id: "1",
        date: now.toISOString(),
      }),
    ).toEqual({
      id: "1",
      date: now.toISOString(),
    });

    expect(
      app.parse(model, {
        id: "1",
        date: now.toISOString(),
      }),
    ).toEqual({
      id: "1",
      date: now.toISOString(),
    });
  });

  it("should cast string to number", () => {
    const app = Alepha.create();
    const value = app.parse(t.number(), "1");
    expect(value).toBe(1);
  });

  it("should parse object schemas", () => {
    const app = Alepha.create();
    const schema = t.object({
      a: t.text(),
      b: t.number(),
    });
    const value = app.parse(schema, {
      a: "hello",
      b: 123,
    });
    expect(value).toEqual({ a: "hello", b: 123 });
  });

  it("should parse arrays of objects", () => {
    const app = Alepha.create();
    const now = new Date();
    const arrayModel = t.array(model);

    expect(
      app.parse(arrayModel, [
        {
          id: "1",
          date: now.toISOString(),
        },
      ]),
    ).toEqual([
      {
        id: "1",
        date: now.toISOString(),
      },
    ]);
  });

  it("should throw on unexpected types", () => {
    const app = Alepha.create();

    expect(() => app.parse(t.text(), () => null)).toThrow(Error);
  });

  it("should handle magic parsing from strings and objects", () => {
    const s = t.object({
      n: t.number(),
    });

    const app = Alepha.create();

    expect(app.parse(s, { n: "1" })).toEqual({ n: 1 });
    expect(app.parse(s, { n: 1 })).toEqual({ n: 1 });
    expect(app.parse(s, '{ "n": 3 }')).toEqual({ n: 3 });
    expect(app.parse(s, '{ "n": "1" }')).toEqual({ n: 1 });
  });
});
