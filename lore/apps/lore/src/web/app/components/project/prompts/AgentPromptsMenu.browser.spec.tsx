import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { projectPromptsAtom } from "@/web/app/atoms/projectPromptsAtom.ts";
import type { AgentPromptSubject } from "@/web/app/prompts/renderPromptTemplate.ts";

import { I18n } from "../../../services/I18n.ts";
import { AgentPromptsMenu } from "./AgentPromptsMenu.tsx";

const subject: AgentPromptSubject = {
  project: "Alepha",
  slug: "alepha",
  number: 41,
  id: 67,
  reference: "#E41",
  title: "Lore Agent Prompts",
  url: "https://lore.alepha.dev/alepha/epics/41",
};

/**
 * The detail-page half of the Agent Prompts menu, shared by the epic, quest
 * and feedback pages.
 *
 * Two of the three cases here are about what it does NOT render, because the
 * failure they guard is a button that opens an empty menu.
 */
describe("AgentPromptsMenu", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    items: Array<{ kind: "epicReview" | "epicActivate" | "questWork" }>,
    project: unknown = projectFixture(),
  ) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, project as never);
    alepha.store.set(projectPromptsAtom, {} as never);

    return render(
      <AlephaContext.Provider value={alepha}>
        <AgentPromptsMenu
          items={items.map((it) => ({ ...it, subject: () => subject }))}
        />
      </AlephaContext.Provider>,
    );
  };

  const stubClipboard = () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    return written;
  };

  it("renders the entries it was given behind one button", async () => {
    await mount([{ kind: "epicReview" }, { kind: "epicActivate" }]);

    const trigger = screen.getByRole("button", { name: /agent prompts/i });
    fireEvent.click(trigger);

    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });
    expect(items.map((it) => it.textContent)).toEqual([
      "Review Epic",
      "Work on it",
    ]);
  });

  it("names the epic's hand-over the way a quest and a feedback item name theirs", async () => {
    /*
     * Feedback #P2182: the epic entries read "Review" and "Activate" while
     * the same act on a quest and on a feedback item reads "Work on it".
     * One verb, so one label and one glyph on all three surfaces. Only the
     * label and the glyph move: `epicActivate` is persisted in
     * `project_prompts.kind`, so the kind keeps its name.
     */
    await mount([{ kind: "epicActivate" }, { kind: "questWork" }]);

    fireEvent.click(screen.getByRole("button", { name: /agent prompts/i }));
    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });

    const [epic, quest] = items;
    expect(epic!.textContent).toBe(quest!.textContent);
    expect(epic!.textContent).toBe("Work on it");
    expect(epic!.querySelector("svg")?.getAttribute("class")).toBe(
      quest!.querySelector("svg")?.getAttribute("class"),
    );
    expect(epic!.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-wrench",
    );
  });

  it("names each entry by its label alone", async () => {
    /*
     * ⚠️ A reversal. Feedback #P2149 added a line under each label saying
     * what the prompt does; feedback #P2183 took it off again, on every
     * surface. The label carries the choice now, so a label that does not
     * say which prompt it is (#P2182 on epics) is the thing to fix, not a
     * reason to bring the line back.
     *
     * The label and the glyph still come from `AGENT_PROMPT_MENU_META`
     * keyed on the kind, never from the caller.
     */
    await mount([{ kind: "epicReview" }]);

    /*
     * ⚠️ **One glyph, and there used to be two.** The second was a
     * `ChevronDown` added by #Q2070 to say that a WORD is a menu; with the
     * labelled trigger gone (feedback #P2175) there is no word for a caret
     * to qualify, and on a 32px square it competed with the glyph that
     * names the thing. Pinned rather than left implicit, because the caret
     * belongs back the moment a visible label does.
     *
     * The name comes from `aria-label`, and `title` carries it to a pointer
     * as well - a glyph with only an `aria-label` is unlabelled to anyone
     * using a mouse, which is the rule #Q2017 records.
     */
    const trigger = screen.getByRole("button", { name: /^agent prompts$/i });
    expect(trigger.querySelectorAll("svg").length).toBe(1);
    expect(trigger.getAttribute("title")).toBe("Agent Prompts");

    fireEvent.click(trigger);

    const item = await waitFor(() => {
      const found = document.querySelector('[role="menuitem"]');
      if (!found) throw new Error("not open yet");
      return found;
    });
    // The label and nothing under it.
    expect(item.textContent).toBe("Review Epic");
    expect(item.textContent).not.toContain("challenge the plan");
    // The default one-line row: nothing top-aligns the glyph for a second
    // line that is not there.
    expect(item.className).not.toContain("items-start");
    // Its own glyph, not the trigger's `Bot`: the row is an action.
    expect(item.querySelector("svg")).not.toBeNull();
  });

  /**
   * ⚠️ Callers build their entries under status gates, so a `done` epic
   * hands over an empty list. A button that opens an empty menu is worse
   * than no button, which is the same rule `AlephaTable` applies to a group
   * with no children.
   */
  it("renders nothing at all when it has no entries", async () => {
    await mount([]);
    expect(screen.queryByRole("button", { name: /agent prompts/i })).toBe(null);
  });

  it("renders nothing when the project has agent prompts off", async () => {
    await mount(
      [{ kind: "epicReview" }],
      projectFixture({ options: { work: { agentPrompts: false } } }),
    );
    expect(screen.queryByRole("button", { name: /agent prompts/i })).toBe(null);
  });

  it("copies the prompt for the kind that was clicked", async () => {
    const written = stubClipboard();
    await mount([{ kind: "epicReview" }, { kind: "epicActivate" }]);

    fireEvent.click(screen.getByRole("button", { name: /agent prompts/i }));
    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });
    fireEvent.click(
      items.find((it) => it.textContent?.includes("Work on it"))!,
    );

    await waitFor(() => expect(written).toHaveLength(1));
    // `epicActivate`'s own text, not the review's. Two entries reading the
    // same kind is the failure a single-entry spec would miss.
    expect(written[0]).toContain("to completion, quest by quest");
    expect(written[0]).not.toContain("Review the plan of epic");
    expect(written[0]).toContain("#E41");
    // The subject is seven fields, so nothing else can be in there.
    expect(written[0]).not.toContain("sg_");
  });
});
