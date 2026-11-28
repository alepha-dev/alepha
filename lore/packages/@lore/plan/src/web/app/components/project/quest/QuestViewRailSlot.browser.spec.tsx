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
import { Rocket } from "lucide-react";
import { describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "../../../../../api/schemas/questResourceSchema.ts";
import QuestViewRail from "./QuestViewRail.tsx";

/**
 * Rows another module registers on the quest rail (#E154): Ship's Live row
 * goes through core's `ResourceRailRegistry`, so Plan names no Ship code.
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
   * none of the controls that gate on a permission. `getEpicRefs` answers the
   * one epic, number 7, carrying {@link EPIC_PR}; everything else `[]`.
   */
  override client(): any {
    const empty: any = async () => [];
    empty.can = () => false;
    const epics: any = async () => [
      { id: 70, number: 7, title: "An epic", pullRequests: [] },
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

describe("QuestViewRail registered rows", () => {
  const mount = async (value: string | undefined) => {
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
    const seen: Array<{ projectId: number; number: number }> = [];
    alepha.inject(ResourceRailRegistry).register({
      resource: "quest",
      key: "live",
      order: 50,
      labelKey: "quest.rail.live",
      icon: Rocket,
      useValue: (subject) => {
        seen.push(subject);
        return value;
      },
    });
    await alepha.start();

    alepha.store.set(currentProjectAtom, {
      ...projectFixture({
        title: "Acme",
        slug: "acme",
        capabilities: ["plan"],
        options: {
          plan: {
            epics: false,
            releases: false,
            chrono: false,
            reminder: false,
            estimate: false,
          },
        },
      }),
    });

    const quest = alepha.inject(Links).quest({ shortId: 42 });

    const view = render(
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
    return { view, seen };
  };

  it("draws a registered row under its label, for this quest's number", async ({
    expect,
  }) => {
    const { view, seen } = await mount("my-app/production");

    await waitFor(() => {
      expect(view.getByText("my-app/production")).toBeTruthy();
    });
    expect(view.getByText("Live")).toBeTruthy();
    expect(seen[0]?.number).toBe(42);
  });

  it("draws nothing, label included, when the row has no value", async ({
    expect,
  }) => {
    const { view } = await mount(undefined);

    await waitFor(() => {
      expect(view.queryByText("Commits")).toBeNull();
    });
    expect(view.queryByText("Live")).toBeNull();
  });
});
