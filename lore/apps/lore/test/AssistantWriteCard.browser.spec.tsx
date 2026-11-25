import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n, userProjectsAtom } from "@lore/core/web";
import { fireEvent, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { assistantConfirmCards } from "@/web/assistant/assistantConfirmCards.ts";

/**
 * The confirmation card of a write (#Q3210): the project first, then every
 * field the call sets, prose as markdown, and the two answers.
 */
describe("the assistant's confirmation cards", () => {
  const mount = async (
    name: string,
    input: Record<string, unknown>,
    answers: { approve: () => void; deny: () => void },
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ id: 7, title: "Acme", slug: "acme" }),
    );
    alepha.store.set(userProjectsAtom, {
      projects: [
        { id: 7, title: "Acme", slug: "acme" },
        { id: 9, title: "Globex", slug: "globex" },
      ].map((it) => ({
        ...projectFixture(it),
        areaCount: 0,
        openQuestCount: 0,
        owner: true,
        lastActivityAt: "2026-01-01T00:00:00.000Z",
      })),
      totalCount: 2,
      ownedCount: 2,
      maxProjects: 50,
      canCreate: true,
    } as never);
    const Card = assistantConfirmCards[name];
    return render(
      <AlephaContext.Provider value={alepha}>
        <Card
          pending={{ callId: "c1", name, input, kind: "confirm" }}
          onApprove={answers.approve}
          onDeny={answers.deny}
        />
      </AlephaContext.Provider>,
    );
  };

  it("has a card for every write tool", ({ expect }) => {
    expect(Object.keys(assistantConfirmCards).sort()).toEqual([
      "feedback_submit",
      "folio_create",
      "quest_comment_add",
      "quest_complete",
      "quest_create",
      "quest_update",
    ]);
  });

  it("shows the project and every field a quest_update sets, prose as markdown", async ({
    expect,
  }) => {
    const answered: string[] = [];
    const view = await mount(
      "quest_update",
      {
        project: 7,
        shortId: 12,
        priority: "high",
        release_tag: "1.2.0",
        description: "Now with **bold** text.",
      },
      {
        approve: () => answered.push("approve"),
        deny: () => answered.push("deny"),
      },
    );
    expect(view.getByText("Update this quest?")).toBeTruthy();
    expect(view.getByTestId("assistant-confirm-project").textContent).toBe(
      "In Acme",
    );
    for (const field of ["shortId", "priority", "release_tag", "description"]) {
      expect(view.getByTestId(`assistant-confirm-field-${field}`)).toBeTruthy();
    }
    expect(
      view
        .getByTestId("assistant-confirm-field-description")
        .querySelector("strong")?.textContent,
    ).toBe("bold");

    fireEvent.click(view.getByRole("button", { name: "Approve" }));
    fireEvent.click(view.getByRole("button", { name: "Deny" }));
    expect(answered).toEqual(["approve", "deny"]);
  });

  it("caps a long quest's fields and scrolls them inside, with Approve and Deny outside the scroll (#Q4303)", async ({
    expect,
  }) => {
    const view = await mount(
      "quest_create",
      {
        project: 7,
        title: "A long one",
        description: Array.from(
          { length: 80 },
          (_, i) => `Paragraph ${i} of a long quest description.`,
        ).join("\n\n"),
        area: "lore/chat",
        priority: "low",
        tags: ["ui"],
        objectives: ["One", "Two", "Three"],
      },
      { approve: () => {}, deny: () => {} },
    );

    // jsdom lays nothing out: the classes are what cap and scroll it.
    const body = view.getByTestId("assistant-confirm-body");
    expect(body.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["max-h-80", "overflow-y-auto"]),
    );
    expect(body.textContent).toContain("Paragraph 79");
    for (const name of ["Approve", "Deny"]) {
      expect(body.contains(view.getByRole("button", { name }))).toBe(false);
    }
  });

  it("warns when the call names another project than the one on screen", async ({
    expect,
  }) => {
    const view = await mount(
      "quest_comment_add",
      { project: 9, shortId: 3, body: "Hello", as: "lore-ai" },
      { approve: () => {}, deny: () => {} },
    );
    expect(view.getByTestId("assistant-confirm-project").textContent).toContain(
      "not the project you are looking at",
    );
    // Provenance the model passes is not something the member decides.
    expect(view.queryByTestId("assistant-confirm-field-as")).toBeNull();
  });

  it("names the project a feedback goes to, by its title, when it is another one (#Q3971)", async ({
    expect,
  }) => {
    const view = await mount(
      "feedback_submit",
      {
        project: 9,
        title: "Exports drop dates",
        description: "Seen while **reviewing** Acme.",
        as: "lore-ai",
      },
      { approve: () => {}, deny: () => {} },
    );
    expect(view.getByText("File this feedback?")).toBeTruthy();
    const target = view.getByTestId("assistant-confirm-project").textContent;
    expect(target).toContain("Globex");
    expect(target).toContain("not the project you are looking at");
    expect(
      view.getByTestId("assistant-confirm-field-title").textContent,
    ).toContain("Exports drop dates");
    expect(
      view
        .getByTestId("assistant-confirm-field-description")
        .querySelector("strong")?.textContent,
    ).toBe("reviewing");
  });
});
