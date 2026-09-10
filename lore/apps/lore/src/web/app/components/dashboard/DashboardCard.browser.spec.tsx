import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";

import { I18n } from "../../services/I18n.ts";
import DashboardCard from "./DashboardCard.tsx";

const card = {
  id: 1,
  metric: "activeQuests",
  scope: { kind: "all" },
  filters: {},
  size: 1,
  position: 0,
} as unknown as DashboardCardResource;

const noop = () => {};

/**
 * The card's edge, which is a Control field's (feedback #P2179).
 *
 * The colours themselves are proven in a browser - that the card and a field
 * resolve to the same two sRGB values in light and in dark - because jsdom
 * computes no styles. What this pins is the part a browser check cannot see
 * by hovering: which rule a card in each state carries, and that the drag-over
 * ring is never fought by the hover edge.
 */
describe("DashboardCard", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (over: boolean) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    render(
      <AlephaContext.Provider value={alepha}>
        <DashboardCard
          card={card}
          labelKey="dashboard.metric.activeQuests"
          icon="list-todo"
          canEdit={false}
          armed={false}
          dragging={false}
          over={over}
          onArm={noop}
          onDisarm={noop}
          onDragStart={noop}
          onDragOver={noop}
          onDrop={noop}
          onDragEnd={noop}
          onChangeScope={noop}
          onDuplicate={noop}
          onRemove={noop}
        />
      </AlephaContext.Provider>,
    );
    return screen.getByTestId("dashboard-card").className;
  };

  it("rests on --input and hovers to --input-hover, the way a Control field does", async ({
    expect,
  }) => {
    const classes = await mount(false);

    expect(classes).toContain("shadow-[inset_0_0_0_1px_var(--input)]");
    expect(classes).toContain(
      "hover:shadow-[inset_0_0_0_1px_var(--input-hover)]",
    );
    // `--border` is decoration (a table rule, a divider); the edge a pointer
    // can act on is a field's.
    expect(classes).not.toContain("var(--border)");
  });

  it("lets the drag-over ring win: no hover edge while a card is dragged over", async ({
    expect,
  }) => {
    const classes = await mount(true);

    expect(classes).toContain("shadow-[inset_0_0_0_2px_var(--primary)]");
    expect(classes).not.toContain("hover:shadow");
  });
});
