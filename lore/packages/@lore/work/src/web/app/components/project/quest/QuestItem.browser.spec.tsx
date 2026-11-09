import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { afterEach, describe, it } from "vitest";

import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import QuestItem from "./QuestItem.tsx";

const questOf = (shortId: number, title: string): QuestResource =>
  ({
    id: shortId,
    shortId,
    projectId: 1,
    title,
    description: "",
    priority: "medium",
    size: 1,
    tags: [],
    objectives: [],
    attachments: [],
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    metadata: {
      status: "in_progress",
      objectivesProgress: { completed: 0, waived: 0, total: 0 },
      totalTimeSpent: 0,
    },
  }) as unknown as QuestResource;

/**
 * The two routes a quest log row resolves: the project, and a quest under it,
 * with the shapes and names the real routers give them.
 *
 * ⚠️ `project` declares `schema.params`, as the real one does, and the spec is
 * worthless without it: `router.path` hands a page that declares its params
 * exactly the ones it was given, and lets any other page inherit the current
 * route's. Leave the schema out and `router.path("project")` answers `/acme`
 * here while it answers `/:projectSlug` in the app.
 */
class Routes {
  project = $page({
    name: "project",
    path: "/:projectSlug",
    schema: {
      params: z.object({
        projectSlug: z.string(),
      }),
    },
    component: () => null,
  });

  quest = $page({
    name: "projectQuest",
    parent: this.project,
    path: "/quests/:shortId",
    component: () => null,
  });
}

/**
 * A quest log row is a toggle: it opens its quest, and the row of the quest
 * already open closes it by going back to the project.
 *
 * That second half was written `router.path("project")`, with no params, and
 * the project page declares its params, so nothing filled the slug. The row
 * of the open quest linked to the literal `/:projectSlug`, a 404 that a
 * refresh reloads (feedback #P2228, quest #Q3269).
 */
describe("QuestItem", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    // jsdom shares one `location` across the file.
    window.history.replaceState({}, "", "/");
  });

  const mount = async (url: `/${string}`, quest: QuestResource) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture());
    await alepha.inject(ReactRouter).push(url);

    return render(
      <AlephaContext.Provider value={alepha}>
        <QuestItem quest={quest} index={0} />
      </AlephaContext.Provider>,
    );
  };

  it("links the row of the open quest back to its project", async ({
    expect,
  }) => {
    await mount("/acme/quests/12", questOf(12, "Open quest"));

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/acme");
  });

  it("links any other row to its quest", async ({ expect }) => {
    await mount("/acme/quests/12", questOf(7, "Another quest"));

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/acme/quests/7");
  });
});
