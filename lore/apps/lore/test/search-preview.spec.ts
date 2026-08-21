import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { SearchController } from "../src/api/controllers/SearchController.ts";

/**
 * `preview` is protected, so it is exposed through a subclass rather than
 * reached around — the TestProvider pattern. Nothing here starts the
 * container: `preview` is pure and touches no repository.
 */
class TestSearchController extends SearchController {
  public testPreview = this.preview.bind(this);
}

const preview = (raw: string | null | undefined) =>
  Alepha.create().inject(TestSearchController).testPreview(raw);

describe("SearchController.preview — palette row context (#189)", () => {
  it("returns undefined for nothing to show", () => {
    expect(preview(undefined)).toBeUndefined();
    expect(preview(null)).toBeUndefined();
    expect(preview("   ")).toBeUndefined();
  });

  it("flattens markdown so syntax never reaches the row", () => {
    expect(preview("## Heading\n\n**bold** and `code`")).toBe(
      "Heading bold and code",
    );
  });

  it("drops fenced code blocks rather than showing their first line", () => {
    expect(preview("Intro\n\n```ts\nconst x = 1;\n```\n\nOutro")).toBe(
      "Intro Outro",
    );
  });

  it("collapses newlines — the row is one line", () => {
    expect(preview("first\nsecond\n\nthird")).toBe("first second third");
  });

  it("truncates past the cap and marks it", () => {
    const out = preview("x".repeat(400));
    expect(out).toHaveLength(141);
    expect(out?.endsWith("…")).toBe(true);
  });

  it("leaves a short line exactly as written", () => {
    expect(preview("A summary for agents.")).toBe("A summary for agents.");
  });
});
