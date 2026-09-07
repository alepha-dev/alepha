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
    items: Array<{ kind: "epicReview" | "epicActivate"; label: string }>,
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
    await mount([
      { kind: "epicReview", label: "Review" },
      { kind: "epicActivate", label: "Activate" },
    ]);

    const trigger = screen.getByRole("button", { name: /agent prompts/i });
    fireEvent.click(trigger);

    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });
    expect(items.map((it) => it.textContent).join(" ")).toContain("Review");
    expect(items.map((it) => it.textContent).join(" ")).toContain("Activate");
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
      [{ kind: "epicReview", label: "Review" }],
      projectFixture({ options: { work: { agentPrompts: false } } }),
    );
    expect(screen.queryByRole("button", { name: /agent prompts/i })).toBe(null);
  });

  it("copies the prompt for the kind that was clicked", async () => {
    const written = stubClipboard();
    await mount([
      { kind: "epicReview", label: "Review" },
      { kind: "epicActivate", label: "Activate" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /agent prompts/i }));
    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });
    fireEvent.click(items.find((it) => it.textContent?.includes("Activate"))!);

    await waitFor(() => expect(written).toHaveLength(1));
    // Activate's own text, not Review's. Two entries reading the same kind
    // is the failure a single-entry spec would miss.
    expect(written[0]).toContain("to completion, quest by quest");
    expect(written[0]).not.toContain("Review the plan of epic");
    expect(written[0]).toContain("#E41");
    // The subject is seven fields, so nothing else can be in there.
    expect(written[0]).not.toContain("sg_");
  });
});
