import { Alepha } from "alepha";
import { describe, test } from "vitest";
import { SecretFilterService } from "../services/SecretFilterService.ts";

describe("SecretFilterService", () => {
  const createFilter = () => {
    const alepha = Alepha.create();
    return alepha.inject(SecretFilterService);
  };

  test("keeps normal secret keys", ({ expect }) => {
    const filter = createFilter();
    const result = filter.filter({
      API_KEY: "abc123",
      REDIS_URL: "redis://localhost",
    });

    expect(result).toEqual({
      API_KEY: "abc123",
      REDIS_URL: "redis://localhost",
    });
  });

  test("keeps DATABASE_URL and POSTGRES_SCHEMA", ({ expect }) => {
    const filter = createFilter();
    const result = filter.filter({
      DATABASE_URL: "postgres://localhost/db",
      POSTGRES_SCHEMA: "public",
    });

    expect(result).toEqual({
      DATABASE_URL: "postgres://localhost/db",
      POSTGRES_SCHEMA: "public",
    });
  });

  test("excludes NODE_ENV", ({ expect }) => {
    const filter = createFilter();
    const result = filter.filter({
      NODE_ENV: "production",
      API_KEY: "abc123",
    });

    expect(result).toEqual({ API_KEY: "abc123" });
  });

  test("excludes VITE_ prefixed keys", ({ expect }) => {
    const filter = createFilter();
    const result = filter.filter({
      VITE_APP_TITLE: "My App",
      VITE_PUBLIC_KEY: "pk_123",
      API_KEY: "abc123",
    });

    expect(result).toEqual({ API_KEY: "abc123" });
  });

  test("excludes empty values", ({ expect }) => {
    const filter = createFilter();
    const result = filter.filter({
      API_KEY: "abc123",
      EMPTY_VAR: "",
    });

    expect(result).toEqual({ API_KEY: "abc123" });
  });

  test("returns empty record when all filtered", ({ expect }) => {
    const filter = createFilter();
    const result = filter.filter({
      NODE_ENV: "production",
      VITE_KEY: "value",
      EMPTY: "",
    });

    expect(result).toEqual({});
  });

  describe("toRemoteName", () => {
    test("prefixes GITHUB_ keys with APP_", ({ expect }) => {
      const filter = createFilter();
      expect(filter.toRemoteName("GITHUB_CLIENT_ID")).toBe(
        "APP_GITHUB_CLIENT_ID",
      );
      expect(filter.toRemoteName("GITHUB_CLIENT_SECRET")).toBe(
        "APP_GITHUB_CLIENT_SECRET",
      );
    });

    test("leaves non-GITHUB_ keys unchanged", ({ expect }) => {
      const filter = createFilter();
      expect(filter.toRemoteName("DATABASE_URL")).toBe("DATABASE_URL");
      expect(filter.toRemoteName("API_KEY")).toBe("API_KEY");
    });
  });

  describe("toLocalName", () => {
    test("strips APP_ prefix from APP_GITHUB_ keys", ({ expect }) => {
      const filter = createFilter();
      expect(filter.toLocalName("APP_GITHUB_CLIENT_ID")).toBe(
        "GITHUB_CLIENT_ID",
      );
    });

    test("leaves non-APP_GITHUB_ keys unchanged", ({ expect }) => {
      const filter = createFilter();
      expect(filter.toLocalName("DATABASE_URL")).toBe("DATABASE_URL");
      expect(filter.toLocalName("APP_SECRET")).toBe("APP_SECRET");
    });
  });
});
