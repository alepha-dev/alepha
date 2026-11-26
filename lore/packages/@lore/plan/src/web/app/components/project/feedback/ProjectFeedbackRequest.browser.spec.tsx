import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { FeedbackSubmitShortcut } from "./FeedbackSubmitShortcut.ts";
import { readDraftFromQuery } from "./readDraftFromQuery.ts";

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

/**
 * The Submit feedback form's shortcut (#Q4453), on a form wired the way the
 * page wires it.
 */
describe("FeedbackSubmitShortcut", () => {
  afterEach(() => cleanup());

  const mount = (busy: boolean) => {
    const submitted: string[] = [];
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted.push("submit");
        }}
      >
        <textarea
          aria-label="message"
          onKeyDown={(event) => FeedbackSubmitShortcut.onKeyDown(event, busy)}
        />
      </form>,
    );
    return { submitted, field: screen.getByLabelText("message") };
  };

  it("submits on Cmd+Enter and on Ctrl+Enter", ({ expect }) => {
    const { submitted, field } = mount(false);
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(submitted).toEqual(["submit", "submit"]);
  });

  it("leaves a plain Enter to the message, as a new line", ({ expect }) => {
    const { submitted, field } = mount(false);
    const plain = fireEvent.keyDown(field, { key: "Enter" });
    // Not prevented: the textarea takes its new line.
    expect(plain).toBe(true);
    expect(submitted).toEqual([]);
  });

  it("does not submit while the form is busy", ({ expect }) => {
    const { submitted, field } = mount(true);
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(submitted).toEqual([]);
  });
});
