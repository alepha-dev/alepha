import { describe, expect, test } from "vitest";
import type { DocNode } from "../../scripts/docs-cli.ts";
import {
  findMatchedKeyword,
  flattenTree,
  type SearchableDoc,
} from "../../src/helpers/search.ts";

describe("flattenTree", () => {
  test("returns empty array for empty input", () => {
    const result = flattenTree([]);
    expect(result).toEqual([]);
  });

  test("extracts single node with href", () => {
    const nodes: DocNode[] = [
      {
        slug: "intro",
        name: "Introduction",
        order: 1,
        href: "/docs/intro",
        keywords: ["getting started", "welcome"],
      },
    ];

    const result = flattenTree(nodes);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Introduction",
      href: "/docs/intro",
      keywords: ["getting started", "welcome"],
      keywordsJoined: "getting started welcome",
    });
  });

  test("skips nodes without href", () => {
    const nodes: DocNode[] = [
      {
        slug: "folder",
        name: "Folder",
        order: 1,
        // no href - this is a folder/category
      },
    ];

    const result = flattenTree(nodes);

    expect(result).toHaveLength(0);
  });

  test("recursively flattens children", () => {
    const nodes: DocNode[] = [
      {
        slug: "getting-started",
        name: "Getting Started",
        order: 1,
        children: [
          {
            slug: "installation",
            name: "Installation",
            order: 1,
            href: "/docs/installation",
            keywords: ["npm", "yarn"],
          },
          {
            slug: "configuration",
            name: "Configuration",
            order: 2,
            href: "/docs/configuration",
            keywords: ["setup"],
          },
        ],
      },
    ];

    const result = flattenTree(nodes);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Installation");
    expect(result[1].name).toBe("Configuration");
  });

  test("flattens deeply nested structure", () => {
    const nodes: DocNode[] = [
      {
        slug: "level1",
        name: "Level 1",
        order: 1,
        children: [
          {
            slug: "level2",
            name: "Level 2",
            order: 1,
            children: [
              {
                slug: "level3",
                name: "Level 3",
                order: 1,
                href: "/docs/deep",
              },
            ],
          },
        ],
      },
    ];

    const result = flattenTree(nodes);

    expect(result).toHaveLength(1);
    expect(result[0].href).toBe("/docs/deep");
  });

  test("handles nodes without keywords", () => {
    const nodes: DocNode[] = [
      {
        slug: "no-keywords",
        name: "No Keywords",
        order: 1,
        href: "/docs/no-keywords",
        // no keywords property
      },
    ];

    const result = flattenTree(nodes);

    expect(result[0].keywords).toEqual([]);
    expect(result[0].keywordsJoined).toBe("");
  });

  test("preserves order of traversal", () => {
    const nodes: DocNode[] = [
      { slug: "a", name: "A", order: 1, href: "/a" },
      { slug: "b", name: "B", order: 2, href: "/b" },
      { slug: "c", name: "C", order: 3, href: "/c" },
    ];

    const result = flattenTree(nodes);

    expect(result.map((n) => n.name)).toEqual(["A", "B", "C"]);
  });
});

describe("findMatchedKeyword", () => {
  const createDoc = (
    name: string,
    href: string,
    keywords: string[],
  ): SearchableDoc => ({
    name,
    href,
    keywords,
    keywordsJoined: keywords.join(" "),
  });

  test("returns null for empty query", () => {
    const doc = createDoc("Test", "/test", ["keyword"]);
    expect(findMatchedKeyword(doc, "")).toBeNull();
  });

  test("returns null when name matches query", () => {
    const doc = createDoc("Security", "/docs/security", [
      "auth",
      "permissions",
    ]);
    expect(findMatchedKeyword(doc, "sec")).toBeNull();
  });

  test("returns null when href matches query", () => {
    const doc = createDoc("Auth Guide", "/docs/security", [
      "auth",
      "permissions",
    ]);
    expect(findMatchedKeyword(doc, "security")).toBeNull();
  });

  test("returns matching keyword when name and href don't match", () => {
    const doc = createDoc("Getting Started", "/docs/intro", [
      "authentication",
      "setup",
    ]);
    expect(findMatchedKeyword(doc, "auth")).toBe("authentication");
  });

  test("returns shortest matching keyword", () => {
    const doc = createDoc("Guide", "/docs/guide", [
      "authentication",
      "auth",
      "authorize",
    ]);
    expect(findMatchedKeyword(doc, "auth")).toBe("auth");
  });

  test("is case-insensitive", () => {
    const doc = createDoc("Guide", "/docs/guide", ["Authentication"]);
    expect(findMatchedKeyword(doc, "AUTH")).toBe("Authentication");
  });

  test("returns null when no keywords match", () => {
    const doc = createDoc("Guide", "/docs/guide", ["setup", "config"]);
    expect(findMatchedKeyword(doc, "auth")).toBeNull();
  });

  test("returns null for doc without keywords", () => {
    const doc = createDoc("Guide", "/docs/guide", []);
    expect(findMatchedKeyword(doc, "anything")).toBeNull();
  });

  test("handles partial keyword matches", () => {
    const doc = createDoc("API", "/docs/api", ["useAction", "useRouter"]);
    expect(findMatchedKeyword(doc, "action")).toBe("useAction");
  });
});
