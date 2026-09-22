import { render } from "@testing-library/react";
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
} from "@/api/schemas/questResourceSchema.ts";
import { I18n } from "@/web/app/services/I18n.ts";

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
  override client(): any {
    const action: any = async () => ({});
    action.can = () => true;
    return new Proxy({} as Record<string, unknown>, { get: () => action });
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
    } as never;
  });

  const mount = async (over: Partial<QuestResource>) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();

    const quest = alepha.inject(Links).quest(over);

    return render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewSettings quest={quest} onUpdate={() => {}} />
      </AlephaContext.Provider>,
    );
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
});
