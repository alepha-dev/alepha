import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { beforeAll, describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "../../../../../api/schemas/questResourceSchema.ts";
import QuestViewSettings from "./QuestViewSettings.tsx";

/**
 * The rail's reminder block (#Q2424).
 *
 * A reminder goes to the assignee, so a quest nobody has accepted cannot
 * carry one. The block used to render anyway, a heading over a sentence
 * saying so, on every unassigned quest; it renders nothing now, border
 * included, since the rule above it is the component's own.
 */
class Links extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  /**
   * Every action answers `can() === true`: the case under test is the quest,
   * not a permission.
   */
  /**
   * Every action the panel called, by name.
   */
  calls: string[] = [];

  override client(): any {
    const action = (name: string) =>
      Object.assign(
        async () => {
          this.calls.push(name);
          return {};
        },
        { can: () => true },
      );
    return new Proxy({}, { get: (_target, prop: string) => action(prop) });
  }

  public quest(over: Partial<QuestResource>): QuestResource {
    return {
      ...this.faker.generate(questResourceSchema),
      id: 1,
      shortId: 1,
      projectId: 1,
      title: "Ship it",
      acceptedAt: undefined,
      acceptedBy: undefined,
      completedAt: undefined,
      reminderInterval: undefined,
      reminderNextAt: undefined,
      ...over,
    };
  }
}

describe("QuestViewSettings", () => {
  // `Segmented` measures its options, with a ResizeObserver jsdom does not
  // have.
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  const mount = async (
    over: Partial<QuestResource>,
    permissions: string[] = ["*"],
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();

    const links = alepha.inject(Links);
    const quest = links.quest(over);
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      permissions,
    } as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewSettings quest={quest} onUpdate={() => {}} />
      </AlephaContext.Provider>,
    );
    return Object.assign(view, { links });
  };

  it("renders nothing on a quest nobody has accepted", async ({ expect }) => {
    const view = await mount({});

    expect(view.container.innerHTML).toBe("");
  });

  it("renders nothing on a completed quest", async ({ expect }) => {
    const view = await mount({
      acceptedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-02T00:00:00.000Z",
    });

    expect(view.container.innerHTML).toBe("");
  });

  it("offers the presets once the quest is accepted", async ({ expect }) => {
    const view = await mount({ acceptedAt: "2026-09-01T00:00:00.000Z" });

    expect(view.getByText("Reminder")).toBeTruthy();
    expect(view.getByText("Weekly")).toBeTruthy();
  });

  it("sets a reminder without creating an automation (#Q3893)", async ({
    expect,
  }) => {
    const view = await mount({ acceptedAt: "2026-09-01T00:00:00.000Z" });

    fireEvent.click(view.getByText("Weekly"));

    await waitFor(() => expect(view.links.calls).toContain("setQuestReminder"));
    expect(
      view.links.calls.filter((it) => it.toLowerCase().includes("automation")),
    ).toEqual([]);
    expect(view.queryByTestId("quest-reminder-create-rule")).toBeNull();
    expect(view.queryByTestId("quest-reminder-no-rule")).toBeNull();
  });
});
