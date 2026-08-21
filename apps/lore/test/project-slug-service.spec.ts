import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { projectTitleSchema } from "../src/api/schemas/projectTitleSchema.ts";
import { ProjectSlugService } from "../src/api/services/ProjectSlugService.ts";

describe("ProjectSlugService", () => {
  const service = () => Alepha.create().inject(ProjectSlugService);

  describe("slugify", () => {
    it("lowercases and joins words with a single dash", ({ expect }) => {
      expect(service().slugify("Hello World")).toBe("hello-world");
    });

    it("collapses a run of separators into one dash", ({ expect }) => {
      expect(service().slugify("Elf - Summer")).toBe("elf-summer");
    });

    it("folds accents to their ASCII base letter", ({ expect }) => {
      expect(service().slugify("Élan Vital")).toBe("elan-vital");
    });

    it("treats underscores as separators", ({ expect }) => {
      expect(service().slugify("my_project_name")).toBe("my-project-name");
    });

    it("trims leading and trailing separators", ({ expect }) => {
      expect(service().slugify("  -Hello World-  ")).toBe("hello-world");
    });

    it("returns an empty string when nothing transliterates", ({ expect }) => {
      // The caller falls back to `fallbackSlug(id)` — see ProjectController.
      expect(service().slugify("日本語")).toBe("");
    });

    it("keeps digits", ({ expect }) => {
      expect(service().slugify("Project 42")).toBe("project-42");
    });
  });

  describe("isReserved", () => {
    it("rejects a reserved word", ({ expect }) => {
      expect(service().isReserved("auth")).toBe(true);
      expect(service().isReserved("api")).toBe(true);
      expect(service().isReserved("new-project")).toBe(true);
    });

    it("rejects the id-fallback namespace", ({ expect }) => {
      // Otherwise a project titled "Project 42" could squat the slug the
      // fallback hands to project #42.
      expect(service().isReserved("project-42")).toBe(true);
    });

    it("allows an ordinary slug", ({ expect }) => {
      expect(service().isReserved("sds")).toBe(false);
      expect(service().isReserved("elf-summer")).toBe(false);
      // "project" alone is not in the fallback namespace.
      expect(service().isReserved("project-x")).toBe(false);
    });
  });

  describe("fallbackSlug", () => {
    it("builds a slug from the project id", ({ expect }) => {
      expect(service().fallbackSlug(42)).toBe("project-42");
    });
  });
});

describe("projectTitleSchema", () => {
  it("accepts a plain title", ({ expect }) => {
    expect(projectTitleSchema.parse("Hello World")).toBe("Hello World");
  });

  it("accepts accented letters", ({ expect }) => {
    expect(projectTitleSchema.parse("Élan Vital")).toBe("Élan Vital");
  });

  it("trims surrounding whitespace", ({ expect }) => {
    expect(projectTitleSchema.parse("  SDS  ")).toBe("SDS");
  });

  it("accepts dashes and underscores", ({ expect }) => {
    expect(projectTitleSchema.parse("Elf - Summer")).toBe("Elf - Summer");
  });

  it("rejects punctuation outside the allowed set", ({ expect }) => {
    expect(() => projectTitleSchema.parse("Hello, World!")).toThrow();
  });

  it("rejects a title starting with a separator", ({ expect }) => {
    expect(() => projectTitleSchema.parse("-nope")).toThrow();
  });

  it("rejects a title shorter than 3 characters after trimming", ({
    expect,
  }) => {
    expect(() => projectTitleSchema.parse("  a  ")).toThrow();
  });

  it("rejects a title longer than 24 characters", ({ expect }) => {
    expect(() => projectTitleSchema.parse("a".repeat(25))).toThrow();
  });
});
