import { afterEach, describe, it } from "vitest";

import { ProjectJoinIntent } from "./ProjectJoinIntent.ts";

/**
 * The join intent carried across sign-in (#Q3649): it names one project,
 * is taken once, and expires.
 */
describe("ProjectJoinIntent", () => {
  const now = 1_800_000_000_000;

  afterEach(() => {
    sessionStorage.clear();
  });

  it("is taken once, for the project it names", ({ expect }) => {
    ProjectJoinIntent.remember("acme", now);

    expect(ProjectJoinIntent.take("other", now)).toBe(false);
    expect(ProjectJoinIntent.take("acme", now + 1000)).toBe(true);
    expect(ProjectJoinIntent.take("acme", now + 2000)).toBe(false);
  });

  it("expires, and a stale one is dropped", ({ expect }) => {
    ProjectJoinIntent.remember("acme", now);

    expect(
      ProjectJoinIntent.take("acme", now + ProjectJoinIntent.TTL + 1),
    ).toBe(false);
    expect(sessionStorage.getItem(ProjectJoinIntent.KEY)).toBeNull();
  });

  it("never exists without a click: nothing stored, nothing taken", ({
    expect,
  }) => {
    expect(ProjectJoinIntent.take("acme", now)).toBe(false);
  });

  it("reads garbage as no intent", ({ expect }) => {
    sessionStorage.setItem(ProjectJoinIntent.KEY, "{not json");
    expect(ProjectJoinIntent.take("acme", now)).toBe(false);
    sessionStorage.setItem(
      ProjectJoinIntent.KEY,
      JSON.stringify({ slug: "acme", at: now + 60_000 }),
    );
    expect(ProjectJoinIntent.take("acme", now)).toBe(false);
  });
});
