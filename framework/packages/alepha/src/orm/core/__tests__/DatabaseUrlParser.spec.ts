import { describe, it } from "vitest";

import { DbUrlError } from "../errors/DbUrlError.ts";
import { DatabaseUrlParser } from "../services/DatabaseUrlParser.ts";

describe("DatabaseUrlParser", () => {
  const parser = new DatabaseUrlParser();

  describe("sqlite", () => {
    it("reads a bare POSIX path, relative or absolute", ({ expect }) => {
      expect(parser.parse("./data/app.db")).toEqual({
        kind: "sqlite",
        url: "./data/app.db",
        path: "./data/app.db",
      });
      expect(parser.parse("/var/lib/app.db")).toMatchObject({
        kind: "sqlite",
        path: "/var/lib/app.db",
      });
      expect(parser.parse("app.db")).toMatchObject({
        kind: "sqlite",
        path: "app.db",
      });
    });

    it("reads a Windows drive letter as a path, not a scheme", ({ expect }) => {
      expect(parser.parse("C:\\data\\app.db")).toMatchObject({
        kind: "sqlite",
        path: "C:\\data\\app.db",
      });
      expect(parser.parse("d:/data/app.db")).toMatchObject({
        kind: "sqlite",
        path: "d:/data/app.db",
      });
    });

    it("strips sqlite:, sqlite:// and file:, keeping an absolute path", ({
      expect,
    }) => {
      expect(parser.parse("sqlite:./app.db")).toMatchObject({
        kind: "sqlite",
        path: "./app.db",
      });
      expect(parser.parse("sqlite://app.db")).toMatchObject({
        kind: "sqlite",
        path: "app.db",
      });
      expect(parser.parse("sqlite:///data/app.db")).toMatchObject({
        kind: "sqlite",
        path: "/data/app.db",
      });
      expect(parser.parse("file:///data/app.db")).toMatchObject({
        kind: "sqlite",
        path: "/data/app.db",
      });
      expect(parser.parse("file:app.db")).toMatchObject({
        kind: "sqlite",
        path: "app.db",
      });
    });

    it("reads memory, bare or behind sqlite://", ({ expect }) => {
      expect(parser.parse(":memory:")).toMatchObject({
        kind: "sqlite",
        path: ":memory:",
      });
      expect(parser.parse("sqlite://:memory:")).toMatchObject({
        kind: "sqlite",
        path: ":memory:",
      });
    });
  });

  describe("cloudflare", () => {
    it("reads d1://binding and d1://name:id", ({ expect }) => {
      expect(parser.parse("d1://DB")).toEqual({
        kind: "d1",
        url: "d1://DB",
        name: "DB",
      });
      expect(parser.parse("d1://my-db:db-id-123")).toEqual({
        kind: "d1",
        url: "d1://my-db:db-id-123",
        name: "my-db",
        id: "db-id-123",
      });
    });

    it("reads hyperdrive://BINDING", ({ expect }) => {
      expect(parser.parse("hyperdrive://HYPERDRIVE")).toEqual({
        kind: "hyperdrive",
        url: "hyperdrive://HYPERDRIVE",
        binding: "HYPERDRIVE",
      });
    });
  });

  describe("postgres", () => {
    it("accepts both spellings, keeping the URL as given", ({ expect }) => {
      const a = "postgres://user:secret@db.example.app:5432/app";
      const b = "postgresql://user:secret@db.example.app/app?sslmode=require";
      expect(parser.parse(a)).toEqual({ kind: "postgres", url: a });
      expect(parser.parse(b)).toEqual({ kind: "postgres", url: b });
      expect(parser.isPostgres(a)).toBe(true);
      expect(parser.isPostgres(b)).toBe(true);
      expect(parser.isPostgres("d1://DB")).toBe(false);
      expect(parser.isPostgres(undefined)).toBe(false);
    });
  });

  describe("missing and unknown", () => {
    it("returns undefined for a missing or empty URL", ({ expect }) => {
      expect(parser.parse(undefined)).toBeUndefined();
      expect(parser.parse(null)).toBeUndefined();
      expect(parser.parse("")).toBeUndefined();
      expect(parser.parse("  ")).toBeUndefined();
    });

    it("throws on an unknown scheme, naming it and never the credentials", ({
      expect,
    }) => {
      const url = "mysql://admin:hunter2@db.example.app/app";
      let caught: unknown;
      try {
        parser.parse(url);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DbUrlError);
      const message = (caught as Error).message;
      expect(message).toContain("'mysql:'");
      expect(message).toContain("postgresql:");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("admin");
      expect(message).not.toContain("db.example.app");
    });

    it("refuses what used to pass through as a SQLite file name", ({
      expect,
    }) => {
      expect(() => parser.parse("redis://localhost:6379")).toThrow(DbUrlError);
      expect(() => parser.parse("http://example.app/db")).toThrow(DbUrlError);
    });
  });
});
