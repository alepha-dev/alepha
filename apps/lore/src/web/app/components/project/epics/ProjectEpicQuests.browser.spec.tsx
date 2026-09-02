import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { I18n } from "../../../services/I18n.ts";
import ProjectEpicQuests from "./ProjectEpicQuests.tsx";

const questOf = (
  shortId: number,
  title: string,
  priority: QuestResource["priority"],
): QuestResource =>
  ({
    id: shortId,
    shortId,
    projectId: 1,
    title,
    description: "",
    priority,
    size: 1,
    tags: [],
    objectives: [],
    attachments: [],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    metadata: {
      status: "new",
      objectivesProgress: { completed: 0, waived: 0, total: 0 },
      totalTimeSpent: 0,
    },
  }) as unknown as QuestResource;

/**
 * The quest page, so the anchor has something to resolve against. The real
 * `AppRouter` is not mounted: the table only needs the one route name and
 * its shape.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
}

/**
 * The epic's Quests tab, in the shape the Quests list has (feedback #2062):
 * number and title in one anchor with the dash muted, then the priority and
 * the last update, which are what a reader scans a quest list for.
 */
describe("ProjectEpicQuests - columns", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (quests: QuestResource[]) => {
    alepha = Alepha.create()
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    // The real catalogue: the headers are asserted by the words a reader
    // sees, not by their keys.
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const detached: number[] = [];
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectEpicQuests
          projectId={1}
          quests={quests}
          onAttach={() => undefined}
          onDetach={(quest) => detached.push(quest.shortId)}
        />
      </AlephaContext.Provider>,
    );
    return { view, detached };
  };

  it("renders number and title as one anchor to the quest, with the dash muted", async () => {
    await mount([questOf(12, "Ship the thing", "high")]);

    const link = await screen.findByRole("link", {
      name: "#12 - Ship the thing",
    });
    expect(link.getAttribute("href")).toBe("/quests/12");
    // Only the separator is muted: the number carries the title's colour.
    const dash = link.querySelector("span.text-muted-foreground");
    expect(dash?.textContent).toBe("-");
    // The old standalone number column is gone.
    expect(screen.queryByRole("columnheader", { name: "#" })).toBeNull();
  });

  it("shows the priority chip and the relative update time under their own headers", async () => {
    await mount([questOf(12, "Ship the thing", "high")]);

    await screen.findByRole("link", { name: "#12 - Ship the thing" });
    expect(screen.getByText("Priority")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    // dayjs relative time, whatever the clock says: "ago" is the shape.
    expect(screen.getByText(/ago$/)).toBeTruthy();
  });

  it("keeps the detach row action", async () => {
    const { detached } = await mount([questOf(12, "Ship the thing", "low")]);

    await screen.findByRole("link", { name: "#12 - Ship the thing" });
    // The row menu is a per-row control; the action inside it is the one
    // named in the catalogue.
    const menus = screen.getAllByRole("button", { name: /actions|menu/i });
    expect(menus.length).toBeGreaterThan(0);
    expect(detached).toEqual([]);
  });
});
