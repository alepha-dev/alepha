import { describe, expect, it } from "vitest";

import { TemplatedPathParser } from "../TemplatedPathParser.ts";

describe("TemplatedPathParser", () => {
  describe("normalize", () => {
    it("removes double separators", () => {
      const parser = new TemplatedPathParser("/foo//bar");
      expect(parser.normalize("/foo//bar")).toBe("/foo/bar");
    });

    it("removes trailing separator", () => {
      const parser = new TemplatedPathParser("/foo/bar/");
      expect(parser.normalize("/foo/bar/")).toBe("/foo/bar");
    });

    it("does not strip the root separator", () => {
      const parser = new TemplatedPathParser("/");
      expect(parser.normalize("/")).toBe("/");
    });

    it("removes both double separators and trailing separator", () => {
      const parser = new TemplatedPathParser("/foo//bar/");
      expect(parser.normalize("/foo//bar/")).toBe("/foo/bar");
    });

    it("works with custom separator", () => {
      const parser = new TemplatedPathParser("foo::bar:", ":");
      expect(parser.normalize("foo::bar:")).toBe("foo:bar");
    });
  });

  describe("hasParams", () => {
    it("returns true when template has {param} placeholders", () => {
      const parser = new TemplatedPathParser("/users/{id}");
      expect(parser.hasParams).toBe(true);
    });

    it("returns false when template has no placeholders", () => {
      const parser = new TemplatedPathParser("/users/profile");
      expect(parser.hasParams).toBe(false);
    });

    it("returns true for multiple params", () => {
      const parser = new TemplatedPathParser("/users/{userId}/posts/{postId}");
      expect(parser.hasParams).toBe(true);
    });
  });

  describe("paramNames", () => {
    it("returns ordered list of param names", () => {
      const parser = new TemplatedPathParser("/users/{userId}/posts/{postId}");
      expect(parser.paramNames).toEqual(["userId", "postId"]);
    });

    it("returns single param name", () => {
      const parser = new TemplatedPathParser("/users/{id}");
      expect(parser.paramNames).toEqual(["id"]);
    });

    it("returns empty array when no params", () => {
      const parser = new TemplatedPathParser("/users/profile");
      expect(parser.paramNames).toEqual([]);
    });
  });

  describe("interpolate", () => {
    it("replaces a single param", () => {
      const parser = new TemplatedPathParser("/users/{id}");
      expect(parser.interpolate({ id: "42" })).toBe("/users/42");
    });

    it("replaces multiple params", () => {
      const parser = new TemplatedPathParser("/users/{userId}/posts/{postId}");
      expect(parser.interpolate({ userId: "7", postId: "99" })).toBe(
        "/users/7/posts/99",
      );
    });

    it("returns template unchanged when no params present", () => {
      const parser = new TemplatedPathParser("/users/profile");
      expect(parser.interpolate({})).toBe("/users/profile");
    });

    it("works with custom separator", () => {
      const parser = new TemplatedPathParser(
        "sensors:{deviceId}:temperature",
        ":",
      );
      expect(parser.interpolate({ deviceId: "device-1" })).toBe(
        "sensors:device-1:temperature",
      );
    });
  });

  describe("extract", () => {
    it("extracts a single param from a concrete path", () => {
      const parser = new TemplatedPathParser("/users/{id}");
      expect(parser.extract("/users/42")).toEqual({ id: "42" });
    });

    it("extracts multiple params from a concrete path", () => {
      const parser = new TemplatedPathParser("/users/{userId}/posts/{postId}");
      expect(parser.extract("/users/7/posts/99")).toEqual({
        userId: "7",
        postId: "99",
      });
    });

    it("returns empty object when template has no params", () => {
      const parser = new TemplatedPathParser("/users/profile");
      expect(parser.extract("/users/profile")).toEqual({});
    });

    it("works with custom separator", () => {
      const parser = new TemplatedPathParser(
        "sensors:{deviceId}:temperature",
        ":",
      );
      expect(parser.extract("sensors:device-1:temperature")).toEqual({
        deviceId: "device-1",
      });
    });

    it("returns null when the path does not match the template", () => {
      const parser = new TemplatedPathParser("/users/{id}");
      expect(parser.extract("/posts/42")).toBeNull();
      expect(parser.extract("/users/42/extra")).toBeNull();
    });

    it("returns null for a parameterless template when path differs", () => {
      const parser = new TemplatedPathParser("/users/profile");
      expect(parser.extract("/users/other")).toBeNull();
    });
  });

  describe("constructor validation", () => {
    it("throws when separator is not a single character", () => {
      expect(() => new TemplatedPathParser("foo", "::")).toThrow();
      expect(() => new TemplatedPathParser("foo", "")).toThrow();
    });
  });

  describe("wildcardize", () => {
    it("replaces {param} with default wildcard '+'", () => {
      const parser = new TemplatedPathParser("/users/{id}");
      expect(parser.wildcardize()).toBe("/users/+");
    });

    it("replaces {param} with '+' (MQTT style)", () => {
      const parser = new TemplatedPathParser("/sensors/{deviceId}/readings");
      expect(parser.wildcardize("+")).toBe("/sensors/+/readings");
    });

    it("replaces {param} with '*' (Redis style)", () => {
      const parser = new TemplatedPathParser("/sensors/{deviceId}/readings");
      expect(parser.wildcardize("*")).toBe("/sensors/*/readings");
    });

    it("replaces multiple params", () => {
      const parser = new TemplatedPathParser("/users/{userId}/posts/{postId}");
      expect(parser.wildcardize("+")).toBe("/users/+/posts/+");
    });

    it("returns template unchanged when no params", () => {
      const parser = new TemplatedPathParser("/users/profile");
      expect(parser.wildcardize("+")).toBe("/users/profile");
    });

    it("works with custom separator and wildcard", () => {
      const parser = new TemplatedPathParser(
        "sensors:{deviceId}:temperature",
        ":",
      );
      expect(parser.wildcardize("*")).toBe("sensors:*:temperature");
    });
  });

  describe("custom separator (colon for Redis)", () => {
    it("interpolates with colon separator", () => {
      const parser = new TemplatedPathParser("cache:{namespace}:{key}", ":");
      expect(parser.interpolate({ namespace: "users", key: "42" })).toBe(
        "cache:users:42",
      );
    });

    it("extracts with colon separator", () => {
      const parser = new TemplatedPathParser("cache:{namespace}:{key}", ":");
      expect(parser.extract("cache:users:42")).toEqual({
        namespace: "users",
        key: "42",
      });
    });

    it("wildcardizes with colon separator", () => {
      const parser = new TemplatedPathParser("cache:{namespace}:{key}", ":");
      expect(parser.wildcardize("*")).toBe("cache:*:*");
    });
  });
});
