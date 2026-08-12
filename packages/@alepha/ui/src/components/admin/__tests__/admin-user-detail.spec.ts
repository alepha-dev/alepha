import { describe, expect, it } from "vitest";
import { resolveUserDetailId } from "../admin-user-detail.tsx";

/**
 * `resolveUserDetailId` is the whole reason `~/git/club/apps/platform` keeps
 * working across a vendored `@alepha/ui` upgrade: it declares its user-detail
 * route as `/users/:id` against this same component, while `AdminRouter`'s
 * own route declares `:userId`. Losing the `:id` fallback would resolve an
 * empty id for that application instead of failing loudly.
 */
describe("resolveUserDetailId", () => {
  it("resolves the id from :userId, this router's own param name", () => {
    expect(resolveUserDetailId({ userId: "abc-123" })).toBe("abc-123");
  });

  it("falls back to :id, the name a vendored consumer may still use", () => {
    expect(resolveUserDetailId({ id: "legacy-456" })).toBe("legacy-456");
  });

  it("prefers :userId when both are present", () => {
    expect(resolveUserDetailId({ userId: "abc-123", id: "legacy-456" })).toBe(
      "abc-123",
    );
  });

  it("resolves to an empty string when neither param is present", () => {
    expect(resolveUserDetailId({})).toBe("");
  });
});
