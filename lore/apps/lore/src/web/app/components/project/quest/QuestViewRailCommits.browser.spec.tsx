import { render } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "@/api/schemas/questResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import QuestViewRail from "./QuestViewRail.tsx";

/**
 * The rail's Commits row.
 *
 * Quest #1574 put the commit message beside the sha and truncated it, to stop
 * it painting over the row label. The rail is a narrow column and a
 * conventional-commit subject never fits, so what survived the clip was the
 * type and the scope - the least informative part of the message. #1701
 * replaces the truncation with a tooltip: the sha is the identifier and the
 * message is the detail, one hover away instead of four words wide.
 */
/**
 * The rail links out to the epic and to a quest, so the router has to exist.
 * Two route names is all it reads; the real `AppRouter` would drag the whole
 * app in for a metadata column.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
  epic = $page({
    name: "projectEpic",
    path: "/epics/:epicNumber",
    component: () => null,
  });
}

class Links extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  /**
   * Every action answers `can() === false`, so the rail renders its rows and
   * none of the controls that gate on a permission. This spec is about one
   * read-only row; a real client would drag the whole permission registry in
   * to assert a `<code>`.
   */
  override client(): any {
    const action: any = async () => [];
    action.can = () => false;
    return new Proxy({} as Record<string, unknown>, { get: () => action });
  }

  public quest(
    commits: Array<{ sha: string; message?: string }>,
  ): QuestResource {
    return {
      ...this.faker.generate(questResourceSchema),
      id: 1,
      shortId: 1,
      projectId: 1,
      title: "Ship it",
      commits: commits as never,
    };
  }
}

describe("QuestViewRail commits", () => {
  const SHA = "7a8ac2d06f1c3b9e4d5a6f7c8b9a0d1e2f3a4b5c";
  const MESSAGE = "feat(lore): a fixed formatting bar above description fields";

  const mount = async (
    commits: Array<{ sha: string; message?: string }>,
    repositoryUrl?: string,
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();

    // The atom validates against `projectResourceSchema`, so the fixture has
    // to be the whole required shape; `projectFixture` is what keeps that
    // from being twenty hand-written copies.
    alepha.store.set(currentProjectAtom, {
      // No capabilities: this file is about the Commits row, and the rail's
      // Epic and Release rows pull in a chart that needs `ResizeObserver`,
      // which jsdom does not have. A fixture claiming surfaces the case does
      // not exercise is how a spec starts failing for somebody else's reason.
      ...projectFixture({
        title: "Alepha",
        slug: "alepha",
        capabilities: [],
      }),
      ...(repositoryUrl ? { repositoryUrl } : {}),
    } as never);

    const quest = alepha.inject(Links).quest(commits);

    return render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewRail
          quest={quest}
          onUpdate={() => {}}
          onShelve={() => {}}
          onUnshelve={() => {}}
          onUnassign={() => {}}
        />
      </AlephaContext.Provider>,
    );
  };

  it("shows the short sha and not the message", async ({ expect }) => {
    const view = await mount([{ sha: SHA, message: MESSAGE }]);

    expect(view.getByText("7a8ac2d")).toBeTruthy();
    // The whole point: the row carries no prose. A truncated message is still
    // present in the DOM and still spends the column's width.
    expect(view.queryByText(MESSAGE)).toBeNull();
    expect(view.container.textContent).not.toContain("feat(lore)");
  });

  it("carries the full message where a hover can reach it", async ({
    expect,
  }) => {
    const view = await mount([{ sha: SHA, message: MESSAGE }]);

    // The tooltip content is not mounted until it opens, so what is asserted
    // here is that the sha is a tooltip TRIGGER - the wiring the row did not
    // have before.
    const trigger = view.container.querySelector(
      '[data-slot="tooltip-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("7a8ac2d");
  });

  it("links the sha into the repository when the project has one", async ({
    expect,
  }) => {
    const view = await mount(
      [{ sha: SHA, message: MESSAGE }],
      "https://github.com/alepha-dev/alepha",
    );

    const link = view.container.querySelector<HTMLAnchorElement>(
      `a[href="https://github.com/alepha-dev/alepha/commit/${SHA}"]`,
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("7a8ac2d");
  });

  it("renders plain text when the project has no repository", async ({
    expect,
  }) => {
    // A row that looks clickable and is not is worse than a row that does
    // not (#1571), and that has to survive the tooltip.
    const view = await mount([{ sha: SHA, message: MESSAGE }]);

    expect(view.container.querySelector("code")?.textContent).toBe("7a8ac2d");
    expect(view.container.querySelector('a[href*="/commit/"]')).toBeNull();
  });

  it("wires no tooltip on a commit with no message", async ({ expect }) => {
    // `quest_commit_add` accepts a bare sha, so an empty tooltip is a real
    // case rather than a defensive one.
    const view = await mount([{ sha: SHA }]);

    expect(view.getByText("7a8ac2d")).toBeTruthy();
    expect(
      view.container.querySelector('[data-slot="tooltip-trigger"]'),
    ).toBeNull();
  });

  it("puts several commits on the same line", async ({ expect }) => {
    const view = await mount([
      { sha: `${SHA.slice(0, 39)}a`, message: "one" },
      { sha: `${SHA.slice(0, 39)}b`, message: "two" },
      { sha: `${SHA.slice(0, 39)}c`, message: "three" },
    ]);

    // A column stacked one commit per row was the old shape; short codes wrap.
    const row = view.container.querySelector(".flex-wrap");
    expect(row).not.toBeNull();
    expect(row?.className).not.toContain("flex-col");
  });
});
