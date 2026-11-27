import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n, userProjectsAtom } from "@lore/core/web";
import { fireEvent, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { assistantConfirmCards } from "@/web/assistant/assistantConfirmCards.ts";
import { AssistantLineDiff } from "@/web/assistant/AssistantLineDiff.ts";

/**
 * Answers the folio read a `folio_update` card makes (#Q4547), and records
 * what it was asked. Substitution rather than `vi.mock`, per `AGENTS.md`.
 */
class FolioLinks extends LinkProvider {
  public asked: Array<{ action: string; params: unknown }> = [];
  public folio: Record<string, unknown> | Error = {
    projectId: 7,
    type: "text",
    shortId: 20,
    title: "Work log",
    protected: false,
    content: "# Log\n\nMonday\nTuesday\n\n## Summary as of 24/11\n\n12 done",
  };

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          const call = async (input?: { params?: unknown }) => {
            this.asked.push({ action: prop, params: input?.params });
            if (this.folio instanceof Error) throw this.folio;
            return this.folio;
          };
          return Object.assign(call, { can: () => true });
        },
      },
    );
  }
}

/**
 * The confirmation card of a write (#Q3210): the project first, then every
 * field the call sets, prose as markdown, and the two answers.
 */
describe("the assistant's confirmation cards", () => {
  const mount = async (
    name: string,
    input: Record<string, unknown>,
    answers: { approve: () => void; deny: () => void },
    folio?: FolioLinks["folio"],
  ) => {
    const alepha = Alepha.create()
      .with({ provide: LinkProvider, use: FolioLinks })
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    const links = alepha.inject(LinkProvider) as FolioLinks;
    if (folio) links.folio = folio;
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
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <Card
          pending={{ callId: "c1", name, input, kind: "confirm" }}
          onApprove={answers.approve}
          onDeny={answers.deny}
        />
      </AlephaContext.Provider>,
    );
    return Object.assign(view, { links });
  };

  it("has a card for every write tool", ({ expect }) => {
    expect(Object.keys(assistantConfirmCards).sort()).toEqual([
      "feedback_submit",
      "folio_create",
      "folio_update",
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

  it("names the folio a folio_update targets and shows its content as a diff of what it becomes (#Q4547)", async ({
    expect,
  }) => {
    const view = await mount(
      "folio_update",
      {
        project: 7,
        shortId: 20,
        content:
          "# Log\n\nMonday\nTuesday\n\n## Summary as of 30/11\n\n15 **done**",
      },
      { approve: () => {}, deny: () => {} },
    );
    expect(view.getByText("Update this folio?")).toBeTruthy();
    const diff = await view.findByTestId("assistant-confirm-folio-diff");
    expect(view.getByTestId("assistant-confirm-folio").textContent).toBe(
      "Folio #F20 Work log",
    );
    expect(view.links.asked).toEqual([
      { action: "getByShortId", params: { projectId: 7, shortId: 20 } },
    ]);
    const lines = [...diff.children].map((line) => [
      line.getAttribute("data-kind"),
      line.textContent,
    ]);
    expect(lines).toEqual([
      ["gap", "3 unchanged lines"],
      ["same", "  Tuesday"],
      ["same", "  "],
      ["del", "- ## Summary as of 24/11"],
      ["add", "+ ## Summary as of 30/11"],
      ["same", "  "],
      ["del", "- 12 done"],
      ["add", "+ 15 **done**"],
    ]);
    // The reference and the body are the folio block's, not field rows.
    expect(view.queryByTestId("assistant-confirm-field-shortId")).toBeNull();
    expect(
      view.getByTestId("assistant-confirm-folio-after").querySelector("strong")
        ?.textContent,
    ).toBe("done");
  });

  it("still shows a folio_update's new content when the folio cannot be read", async ({
    expect,
  }) => {
    const view = await mount(
      "folio_update",
      { project: 7, shortId: 20, content: "Only **this**", summary: "Short" },
      { approve: () => {}, deny: () => {} },
      new Error("not found"),
    );
    const after = await view.findByTestId("assistant-confirm-folio-after");
    expect(after.querySelector("strong")?.textContent).toBe("this");
    expect(view.queryByTestId("assistant-confirm-folio-diff")).toBeNull();
    expect(view.getByTestId("assistant-confirm-folio-nodiff").textContent).toBe(
      "The folio could not be read, so nothing to compare: its new content is below.",
    );
    expect(view.getByTestId("assistant-confirm-folio").textContent).toBe(
      "Folio #F20",
    );
    expect(
      view.getByTestId("assistant-confirm-field-summary").textContent,
    ).toContain("Short");
  });

  it("says a folio_update leaves the content as it is when it does", async ({
    expect,
  }) => {
    const view = await mount(
      "folio_update",
      { project: 7, shortId: 20, content: "Same", title: "Renamed" },
      { approve: () => {}, deny: () => {} },
      {
        projectId: 7,
        type: "text",
        shortId: 20,
        title: "Work log",
        protected: false,
        content: "Same",
      },
    );
    expect(
      (await view.findByTestId("assistant-confirm-folio-same")).textContent,
    ).toBe("Its content stays the same.");
    expect(view.queryByTestId("assistant-confirm-folio-after")).toBeNull();
    expect(
      view.getByTestId("assistant-confirm-field-title").textContent,
    ).toContain("Renamed");
  });

  it("names the project a folio_update's folio lives in when it is not the one on screen", async ({
    expect,
  }) => {
    const view = await mount(
      "folio_update",
      {
        project: 7,
        id: "0b6f3c1e-2d4a-4f5b-9c8d-7e6f5a4b3c2d",
        content: "x",
      },
      { approve: () => {}, deny: () => {} },
      {
        projectId: 9,
        type: "text",
        shortId: 4,
        title: "Their notes",
        protected: false,
        content: "y",
      },
    );
    expect(
      (await view.findByTestId("assistant-confirm-folio-elsewhere"))
        .textContent,
    ).toBe("(in Globex, not the project you are looking at)");
    expect(view.links.asked).toEqual([
      {
        action: "get",
        params: { id: "0b6f3c1e-2d4a-4f5b-9c8d-7e6f5a4b3c2d" },
      },
    ]);
  });

  it("warns that a folio_update's content will be refused on a protected folio or a table", async ({
    expect,
  }) => {
    const protectedView = await mount(
      "folio_update",
      { project: 7, shortId: 20, content: "Plain" },
      { approve: () => {}, deny: () => {} },
      {
        projectId: 7,
        type: "text",
        shortId: 20,
        title: "Secrets",
        protected: true,
        content: "envelope",
      },
    );
    expect(
      (await protectedView.findByTestId("assistant-confirm-folio-refused"))
        .textContent,
    ).toContain("This folio is protected");
    expect(
      protectedView.queryByTestId("assistant-confirm-folio-diff"),
    ).toBeNull();
    protectedView.unmount();

    const table = await mount(
      "folio_update",
      { project: 7, shortId: 21, content: "| a |" },
      { approve: () => {}, deny: () => {} },
      {
        projectId: 7,
        type: "table",
        shortId: 21,
        title: "Backlog",
        protected: false,
        content: "",
      },
    );
    expect(
      (await table.findByTestId("assistant-confirm-folio-refused")).textContent,
    ).toContain("This folio is a table");
    expect(table.queryByTestId("assistant-confirm-folio-diff")).toBeNull();
  });
});

describe("AssistantLineDiff", () => {
  it("keeps two lines around each change and folds longer runs into gaps", ({
    expect,
  }) => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "D", "e", "f", "g", "h"].join("\n");
    expect(AssistantLineDiff.diff(before, after)).toEqual([
      // A run of one line is kept: its gap would be no shorter.
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
      { kind: "same", text: "c" },
      { kind: "del", text: "d" },
      { kind: "add", text: "D" },
      { kind: "same", text: "e" },
      { kind: "same", text: "f" },
      { kind: "gap", text: "2" },
    ]);
  });

  it("answers an empty diff for equal texts, and none past its size cap", ({
    expect,
  }) => {
    expect(AssistantLineDiff.diff("x\ny", "x\ny")).toEqual([]);
    const long = "x\n".repeat(AssistantLineDiff.MAX_LINES + 1);
    expect(AssistantLineDiff.diff(long, "x")).toBeUndefined();
  });
});
