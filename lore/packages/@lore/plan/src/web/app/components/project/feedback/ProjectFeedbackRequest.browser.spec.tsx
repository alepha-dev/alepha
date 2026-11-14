import { describe, it } from "vitest";

import { readDraftFromQuery } from "./ProjectFeedbackRequest.tsx";

describe("readDraftFromQuery", () => {
  const manyTags = (count: number) => {
    const query = new URLSearchParams();
    for (let i = 0; i < count; i++) {
      query.append("tags", `tag-${i}`);
    }
    return query;
  };

  /**
   * `feedbackBodySchema` refuses a 21st tag, so a link carrying 20 and a `type`
   * used to fill a form whose submit could only fail.
   */
  it("keeps to the 20 tags the server takes, `type` included", ({ expect }) => {
    const query = manyTags(20);
    query.set("type", "bug");

    const { tags } = readDraftFromQuery(query);

    expect(tags).toHaveLength(20);
    expect(tags?.[0]).toBe("bug");
    expect(tags).not.toContain("tag-19");
  });

  it("cuts a longer list to 20 with no `type`", ({ expect }) => {
    const { tags } = readDraftFromQuery(manyTags(25));

    expect(tags).toHaveLength(20);
    expect(tags?.at(-1)).toBe("tag-19");
  });

  it("does not add a `type` already among the tags", ({ expect }) => {
    const query = new URLSearchParams("tags=feature&type=feature");

    expect(readDraftFromQuery(query).tags).toEqual(["feature"]);
  });
});
