import { BookOpen, Lightbulb, Server, Trash2 } from "lucide-react";
import { describe, it } from "vitest";

import { resolveDirectoryBadge } from "./folioDirectoryIcons.ts";

describe("resolveDirectoryBadge", () => {
  it("should give a named directory its own badge", ({ expect }) => {
    expect(resolveDirectoryBadge("trash")).toBe(Trash2);
    expect(resolveDirectoryBadge("ideas")).toBe(Lightbulb);
  });

  it("should match regardless of case and surrounding whitespace", ({
    expect,
  }) => {
    expect(resolveDirectoryBadge("Trash")).toBe(Trash2);
    expect(resolveDirectoryBadge("  TRASH ")).toBe(Trash2);
  });

  it("should leave an unmapped directory unbadged", ({ expect }) => {
    expect(resolveDirectoryBadge("framework")).toBeUndefined();
  });

  it("should not match a name that merely contains a mapped one", ({
    expect,
  }) => {
    expect(resolveDirectoryBadge("trashed drafts")).toBeUndefined();
  });

  it("should give singular and plural the same badge", ({ expect }) => {
    expect(resolveDirectoryBadge("doc")).toBe(BookOpen);
    expect(resolveDirectoryBadge("docs")).toBe(BookOpen);
  });

  it("should give synonyms of one subject the same badge", ({ expect }) => {
    expect(resolveDirectoryBadge("infra")).toBe(Server);
    expect(resolveDirectoryBadge("infrastructure")).toBe(Server);
    expect(resolveDirectoryBadge("ops")).toBe(Server);
  });
});
