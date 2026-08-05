import { describe, expect, it } from "vitest";
import { artifacts, isMutableTag } from "../src/api/entities/artifacts.ts";

/**
 * The tag rules, before any service sits on top.
 *
 * `isMutableTag` is the whole retention policy in one predicate — everything
 * else (replace-in-place vs refuse) reads off it — so it is worth pinning
 * directly rather than only through the service that consumes it.
 */
describe("artifacts entity", () => {
  it("should treat only `latest` as mutable", () => {
    expect(isMutableTag("latest")).toBe(true);
    expect(isMutableTag("1.2.3")).toBe(false);
    expect(isMutableTag("nightly")).toBe(false);
    expect(isMutableTag("Latest")).toBe(false);
  });

  it("should key uniqueness on project + app + tag, not environment", () => {
    const indexes = (artifacts.options.indexes ?? []) as Array<{
      columns: string[];
      unique?: boolean;
    }>;
    const unique = indexes.find((index) => index.unique);

    expect(unique).toBeDefined();
    expect(unique?.columns).toEqual(["projectId", "app", "tag"]);
  });
});
