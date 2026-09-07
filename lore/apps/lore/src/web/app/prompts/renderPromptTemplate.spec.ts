import { describe, expect, it } from "vitest";

import {
  type AgentPromptSubject,
  renderPromptTemplate,
} from "./renderPromptTemplate.ts";

const subject: AgentPromptSubject = {
  project: "Alepha",
  slug: "alepha",
  number: 31,
  id: 57,
  reference: "#E31",
  title: "Epic Workflow",
  url: "https://lore.alepha.dev/alepha/epics/31",
};

describe("renderPromptTemplate", () => {
  it("substitutes all seven placeholders", () => {
    const out = renderPromptTemplate(
      "{{project}}|{{slug}}|{{number}}|{{id}}|{{reference}}|{{title}}|{{url}}",
      subject,
    );
    expect(out).toBe(
      "Alepha|alepha|31|57|#E31|Epic Workflow|https://lore.alepha.dev/alepha/epics/31",
    );
  });

  /**
   * The title and the slug are two fields because they are two values.
   * `project_name` matches `projects.title` lowercased and never the slug,
   * so a project titled "Kanban v2" needs the title in `{{project}}` and
   * the slug only where a URL is being written by hand.
   */
  it("keeps the title and the slug apart", () => {
    const out = renderPromptTemplate("name={{project}} url=/{{slug}}/epics", {
      ...subject,
      project: "Kanban v2",
      slug: "kanban-v2",
    });
    expect(out).toBe("name=Kanban v2 url=/kanban-v2/epics");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderPromptTemplate("{{ title }} and {{  url  }}", subject)).toBe(
      "Epic Workflow and https://lore.alepha.dev/alepha/epics/31",
    );
  });

  /**
   * Never emptied: a typo in a customised template has to be visible in the
   * pasted text, not a silently blank line.
   */
  it("leaves an unknown placeholder verbatim", () => {
    expect(renderPromptTemplate("a {{nope}} b {{title}}", subject)).toBe(
      "a {{nope}} b Epic Workflow",
    );
  });

  it("returns a template with no placeholders unchanged", () => {
    const plain = "Just words, a { brace and a } brace.";
    expect(renderPromptTemplate(plain, subject)).toBe(plain);
  });

  /**
   * ⚠️ The load-bearing case. The naive shape (reduce `String.replaceAll`
   * over the seven fields) substitutes `{{title}}` first and then rescans
   * what it just wrote, so a quest whose title happens to contain `{{url}}`
   * has its own title rewritten. One pass, and a value is never revisited.
   */
  it("never expands a placeholder that arrives inside a value", () => {
    const out = renderPromptTemplate("Quest: {{title}}", {
      ...subject,
      title: "Fix {{url}} handling",
    });
    expect(out).toBe("Quest: Fix {{url}} handling");
    expect(out).not.toContain("https://lore.alepha.dev");
  });

  /**
   * Same rule from the other side: `{{url}}` appearing after the value that
   * contains it is still substituted, because the pass reaches it on its
   * own and not through the value.
   */
  it("still substitutes a later real placeholder", () => {
    const out = renderPromptTemplate("{{title}} then {{url}}", {
      ...subject,
      title: "Fix {{url}} handling",
    });
    expect(out).toBe(
      "Fix {{url}} handling then https://lore.alepha.dev/alepha/epics/31",
    );
  });

  /**
   * The renderer takes seven named fields and not a resource object
   * precisely so nothing can ride along. This text leaves Lore through the
   * clipboard; a `sg_` token in it would be a leak with no error.
   */
  it("carries nothing but the fields it was given", () => {
    const out = renderPromptTemplate("{{project}} {{token}} {{reference}}", {
      ...subject,
      // @ts-expect-error the subject type has no such field, and that is the point
      token: "sg_alepha_supersecret",
    });
    expect(out).not.toContain("sg_alepha_supersecret");
    expect(out).toBe("Alepha {{token}} #E31");
  });
});
