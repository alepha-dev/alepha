import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { EpicReviewAnswer } from "../../../../../api/schemas/epicReviewAnswerSchema.ts";
import type { EpicReviewsResult } from "../../../../../api/schemas/epicReviewsResultSchema.ts";
import ProjectEpicReview from "./ProjectEpicReview.tsx";

/**
 * Nothing here calls the API: the tab hands every answer to `onAnswer`.
 */
class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
  }
}

/**
 * The two pages a change item links to.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/:projectSlug/quests/:shortId",
    component: () => null,
  });
  epic = $page({
    name: "projectEpic",
    path: "/:projectSlug/epics/:epicNumber",
    component: () => null,
  });
}

const item = (fields: Record<string, unknown>) => ({
  id: Number(fields.number),
  reviewId: 1,
  epicId: 7,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  context: "",
  suggestions: [],
  ...fields,
});

const reviews = {
  openQuestions: 1,
  reviews: [
    {
      id: 1,
      projectId: 1,
      epicId: 7,
      createdAt: "2026-11-08T10:00:00.000Z",
      summary: "One question, one call.",
      items: [
        item({
          number: 1,
          kind: "question",
          title: "Which table holds it?",
          state: "open",
          suggestions: [
            { label: "One table", cost: "a rebuild" },
            { label: "Two tables", cost: "a join" },
          ],
          recommended: 1,
        }),
        item({
          number: 2,
          kind: "question",
          title: "Notify the owner?",
          state: "answered",
          answer: "No.",
        }),
        item({ number: 3, kind: "decision", title: "Keep the name." }),
        item({
          number: 4,
          kind: "change",
          title: "Sharpened the quest.",
          target: { kind: "quest", number: 12 },
        }),
      ],
    },
  ],
} as unknown as EpicReviewsResult;

/**
 * The epic page's Review tab (#E121): the open questions answerable in
 * place, the decision log with an overturn, and the reviews with the changes
 * they made.
 */
describe("ProjectEpicReview", () => {
  const mount = async (
    props: { writable?: boolean; reviews?: EpicReviewsResult | null } = {},
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    alepha.inject(Routes);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ id: 1, slug: "acme" } as never),
    );

    const answers: Array<[number, EpicReviewAnswer]> = [];
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpicReview
            epicId={7}
            reviews={props.reviews === undefined ? reviews : props.reviews}
            writable={props.writable ?? true}
            busy={false}
            onAnswer={(number, answer) => answers.push([number, answer])}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { alepha, view, answers };
  };

  it("lists the open question with its number, suggestions and pick", async ({
    expect,
  }) => {
    const { alepha } = await mount();

    expect(await screen.findByText("Open questions (1)")).toBeDefined();
    const card = screen.getByTestId("epic-review-question-1");
    expect(card.textContent).toContain("Which table holds it?");
    expect(card.textContent).toContain("One table");
    expect(card.textContent).toContain("(a join)");
    expect(card.textContent).toContain("Recommended");

    await alepha.stop();
  });

  it("answers by suggestion and waives through onAnswer", async ({
    expect,
  }) => {
    const { alepha, answers } = await mount();

    const picks = await screen.findAllByRole("button", { name: "Take this" });
    fireEvent.click(picks[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Waive" }));

    expect(answers).toEqual([
      [1, { suggestion: 1 }],
      [1, { waive: true }],
    ]);

    await alepha.stop();
  });

  it("keeps answered questions and standing decisions in the log", async ({
    expect,
  }) => {
    const { alepha } = await mount();

    expect(
      (await screen.findByTestId("epic-review-log-2")).textContent,
    ).toContain("No.");
    expect(screen.getByTestId("epic-review-log-3").textContent).toContain(
      "Keep the name.",
    );
    expect(screen.queryByTestId("epic-review-log-1")).toBeNull();
    expect(screen.getByRole("button", { name: "Overturn" })).toBeDefined();

    await alepha.stop();
  });

  it("lists each review with the changes it made, linked", async ({
    expect,
  }) => {
    const { alepha } = await mount();

    expect(await screen.findByText("One question, one call.")).toBeDefined();
    const link = screen.getByText("#Q12");
    expect(link.closest("a")?.getAttribute("href")).toContain(
      "/acme/quests/12",
    );

    await alepha.stop();
  });

  it("offers no control once the review set is read-only", async ({
    expect,
  }) => {
    const { alepha } = await mount({ writable: false });

    await screen.findByText("Open questions (1)");
    expect(screen.queryByRole("button", { name: "Waive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Overturn" })).toBeNull();
    for (const pick of screen.getAllByRole("button", { name: "Take this" })) {
      expect(pick.hasAttribute("disabled")).toBe(true);
    }

    await alepha.stop();
  });

  it("says when no review was ever filed", async ({ expect }) => {
    const { alepha } = await mount({
      reviews: { reviews: [], openQuestions: 0 },
    });

    expect(
      await screen.findByText(/No review has been filed for this epic yet/),
    ).toBeDefined();

    await alepha.stop();
  });
});
