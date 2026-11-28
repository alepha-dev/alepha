import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n, ResourceRailRegistry } from "@lore/core/web";
import { render, waitFor } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "../../../../../api/schemas/questResourceSchema.ts";
import QuestViewRail from "./QuestViewRail.tsx";

/**
 * The rail's Pull requests row (#Q3707): the quest's own, or its epic's when
 * it has none, each linked by the URL it was recorded with.
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

const PR = {
  url: "https://github.com/acme/crm/pull/118",
  number: 118,
  title: "feat: wire the pipeline",
  at: "2026-11-15T10:00:00.000Z",
  by: "00000000-0000-4000-8000-000000000001",
};

const EPIC_PR = {
  url: "https://github.com/acme/crm/pull/120",
  number: 120,
  at: "2026-11-15T10:00:00.000Z",
  by: "00000000-0000-4000-8000-000000000001",
};

class Links extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  /**
   * Every action answers `can() === false`, so the rail renders its rows and
   * none of the controls that gate on a permission. `getEpicRefs` answers the
   * one epic, number 7, carrying {@link EPIC_PR}; everything else `[]`.
   */
  override client(): any {
    const empty: any = async () => [];
    empty.can = () => false;
    const epics: any = async () => [
      { id: 70, number: 7, title: "One pull request", pullRequests: [EPIC_PR] },
    ];
    epics.can = () => false;
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name) => (name === "getEpicRefs" ? epics : empty),
    });
  }

  public quest(over: Partial<QuestResource>): QuestResource {
    return {
      ...this.faker.generate(questResourceSchema),
      id: 1,
      shortId: 1,
      projectId: 1,
      title: "Ship it",
      commits: [],
      pullRequests: undefined,
      epicId: undefined,
      ...over,
    };
  }
}

describe("QuestViewRail pull requests", () => {
  const mount = async (over: Partial<QuestResource>) => {
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
    // Read by the quest rail (#E154), so it must exist before the lock.
    alepha.inject(ResourceRailRegistry);
    await alepha.start();

    // Plan with epics only: the Release row and the chrono pull in controls
    // this file does not exercise.
    alepha.store.set(currentProjectAtom, {
      ...projectFixture({
        title: "Acme",
        slug: "acme",
        capabilities: ["plan"],
        options: {
          plan: {
            epics: true,
            releases: false,
            chrono: false,
            reminder: false,
            estimate: false,
          },
        },
      }),
    });

    const quest = alepha.inject(Links).quest(over);

    return render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewRail
          quest={quest}
          onUpdate={() => {}}
          onShelve={() => {}}
          onUnshelve={() => {}}
          onHold={() => {}}
          onUnhold={() => {}}
          onUnassign={() => {}}
          onReady={() => {}}
          onDraft={() => {}}
        />
      </AlephaContext.Provider>,
    );
  };

  it("links the quest's own pull request by its url", async ({ expect }) => {
    const view = await mount({ pullRequests: [PR] });

    const link = view.container.querySelector<HTMLAnchorElement>(
      `a[href="${PR.url}"]`,
    );
    expect(link?.textContent).toBe("#118");
    expect(link?.target).toBe("_blank");
    expect(view.queryByText("From the epic")).toBeNull();
  });

  it("shows the url when no number was recorded", async ({ expect }) => {
    const view = await mount({ pullRequests: [{ ...PR, number: undefined }] });

    expect(
      view.container.querySelector(`a[href="${PR.url}"]`)?.textContent,
    ).toBe("github.com/acme/crm/pull/118");
  });

  it("renders nothing for a quest with none and no epic", async ({
    expect,
  }) => {
    const view = await mount({});

    expect(view.queryByText("Pull requests")).toBeNull();
  });

  it("shows the epic's when the quest has none of its own", async ({
    expect,
  }) => {
    const view = await mount({ epicId: 70 });

    await waitFor(() =>
      expect(
        view.container.querySelector(`a[href="${EPIC_PR.url}"]`)?.textContent,
      ).toBe("#120"),
    );
    expect(view.getByText("From the epic")).toBeTruthy();
  });

  it("prefers the quest's own over the epic's", async ({ expect }) => {
    const view = await mount({ epicId: 70, pullRequests: [PR] });

    await waitFor(() => expect(view.getByText("#E7")).toBeTruthy());
    expect(view.container.querySelector(`a[href="${PR.url}"]`)).not.toBeNull();
    expect(view.container.querySelector(`a[href="${EPIC_PR.url}"]`)).toBeNull();
    expect(view.queryByText("From the epic")).toBeNull();
  });
});
