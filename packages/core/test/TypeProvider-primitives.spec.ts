import { describe, expect, it } from "vitest";
import { Alepha, TypeBoxError, t } from "../src";

describe("TypeProvider primitive types", () => {
  it("should parse and validate integers", () => {
    const a = Alepha.create();
    const m = t.int();

    expect(a.parse(m, 0)).toBe(0);
    expect(a.parse(m, 1.1)).toBe(1);
    expect(a.parse(m, "0")).toBe(0);
    expect(a.parse(m, 2147483647)).toBe(2147483647);
    expect(a.parse(m, -2147483647)).toBe(-2147483647);
    expect(() => a.parse(m, -2147483648)).toThrow(TypeBoxError);
    expect(() => a.parse(m, 2147483648)).toThrow(TypeBoxError);
  });

  it("should parse and validate numbers", () => {
    const a = Alepha.create();
    const m = t.number();

    expect(a.parse(m, 0)).toBe(0);
    expect(a.parse(m, 1.1)).toBe(1.1);
    expect(a.parse(m, "0")).toBe(0);
    expect(() => a.parse(m, "a")).toThrow(TypeBoxError);
  });

  it("should parse and validate booleans", () => {
    const a = Alepha.create();
    const m = t.boolean();

    expect(a.parse(m, true)).toBe(true);
    expect(a.parse(m, false)).toBe(false);
    expect(a.parse(m, 1)).toBe(true);
    expect(a.parse(m, 0)).toBe(false);
    expect(a.parse(m, "true")).toBe(true);
    expect(a.parse(m, "false")).toBe(false);
    expect(() => a.parse(m, "a")).toThrow(TypeBoxError);
  });

  it("should parse and validate strings", () => {
    const a = Alepha.create();
    const m = t.text();

    expect(a.parse(m, "a")).toBe("a");
    expect(a.parse(m, 1)).toBe("1");
    expect(a.parse(m, true)).toBe("true");
    expect(a.parse(m, false)).toBe("false");
    expect(() => a.parse(m, { hello: "world" })).toThrow(TypeBoxError);
  });

  it("should parse and validate arrays", () => {
    const a = Alepha.create();
    const m = t.array(t.text());

    expect(a.parse(m, ["a", "b"])).toEqual(["a", "b"]);
    expect(a.parse(m, ["a", 1])).toEqual(["a", "1"]);
    expect(a.parse(m, [1])).toEqual(["1"]);
  });

  it("should parse and validate enums", () => {
    const a = Alepha.create();
    const m = t.enum(["a", "b"]);

    expect(a.parse(m, "a")).toBe("a");
    expect(a.parse(m, "b")).toBe("b");
    expect(() => a.parse(m, "c")).toThrow(TypeBoxError);
  });
});
