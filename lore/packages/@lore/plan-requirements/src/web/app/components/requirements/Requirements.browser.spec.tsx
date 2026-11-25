import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  ElementReferenceRegistry,
  I18n,
  PinnedPromptsSlot,
} from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import RequirementsPage from "../pages/RequirementsPage.tsx";
import RequirementDetail from "./RequirementDetail.tsx";

const aRequirement = (
  over: Partial<RequirementResource>,
): RequirementResource =>
  ({
    id: 1,
    projectId: 1,
    number: 5,
    statement: "The discount is visible before payment",
    description: "",
    type: "functional",
    priority: "must",
    chapter: "3. Promotions",
    paragraph: "3.2",
    criteria: [
      {
        useCaseId: 1,
        useCaseNumber: 7,
        useCaseTitle: "Promo",
        key: "C2",
        summary: "discount shown",
        method: "e2e",
      },
    ],
    coveringEpics: [{ id: 9, number: 5, title: "Promotions", releaseId: 3 }],
    personas: [{ number: 2, name: "Léa" }],
    targetRelease: { id: 3, number: 2, tag: "2.4.0", mode: "auto" },
    status: "covered",
    metricDays: [],
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T10:00:00.000Z",
    ...over,
  }) as RequirementResource;

const ROWS = [
  aRequirement({}),
  aRequirement({
    id: 2,
    number: 12,
    statement: "A replayed webhook never charges twice",
    chapter: "4. Payment",
    paragraph: "4.3",
    criteria: [],
    coveringEpics: [],
    targetRelease: { id: 4, number: 1, tag: "2.3.1", mode: "by_hand" },
    status: "not_covered",
    sourceChanged: true,
    sourceChangeKind: "edited",
  }),
];

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getRequirements: async () => ROWS,
      getRequirementReleases: async () => [
        { id: 3, number: 2, tag: "2.4.0" },
        { id: 4, number: 1, tag: "2.3.1" },
      ],
    });
  }
}

class StubPages {
  projectRequirements = $page({
    name: "projectRequirements",
    path: "/:projectSlug/requirements",
    component: () => null,
  });
  projectRequirementsTestBook = $page({
    name: "projectRequirementsTestBook",
    path: "/:projectSlug/requirements/test-book",
    component: () => null,
  });
}

/**
 * The Requirements tab and its detail pane (#E153, #Q3769).
 */
describe("Requirements screens", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const boot = async (permissions: string[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n)
      .with(ElementReferenceRegistry)
      // Core's pins slot (#E175), read by the pages' robot button (#Q4412).
      .with(PinnedPromptsSlot)
      .with(StubPages);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture({ capabilities: ["plan"] }),
      slug: "acme",
      permissions,
    } as never);
    return alepha;
  };

  it("groups the list by chapter, with release, verified by and status, and names the changed sources", async ({
    expect,
  }) => {
    const app = await boot(["requirement:read", "requirement:write"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <RequirementsPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await screen.findByText("The discount is visible before payment");
    const table = screen.getByTestId("requirements-table");
    expect(table.textContent).toContain("3. Promotions");
    expect(table.textContent).toContain("4. Payment");
    expect(table.textContent).toContain("2.4.0 auto");
    expect(table.textContent).toContain("2.3.1 by hand");
    expect(table.textContent).toContain("#U7 C2");
    expect(screen.getByTestId("source-changed-banner").textContent).toContain(
      "#S12",
    );
    expect(
      screen.getByRole("button", { name: /New requirement/ }),
    ).toBeTruthy();
  });

  it("draws the detail pane: release note, criteria, personas, and no write for a viewer", async ({
    expect,
  }) => {
    const app = await boot(["requirement:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <RequirementDetail
            requirement={ROWS[0]}
            releases={[{ id: 3, tag: "2.4.0" }]}
            onChange={() => {}}
            onEdit={() => {}}
            onDeleted={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const pane = await screen.findByTestId("requirement-detail");
    expect(pane.textContent).toContain("§3.2");
    expect(pane.textContent).toContain("Léa");
    expect(screen.getByTestId("release-note").textContent).toContain("#E5");
    expect(pane.textContent).toContain("#U7 C2");
    expect(
      screen.queryByRole("button", { name: /Edit requirement/ }),
    ).toBeNull();
  });

  it("draws a metric requirement: its measure, value, since when and 14 days (#Q3773)", async ({
    expect,
  }) => {
    const app = await boot(["requirement:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <RequirementDetail
            requirement={aRequirement({
              number: 15,
              statement: "Checkout paints fast",
              criteria: [],
              metric: {
                kind: "vital",
                vital: "lcp",
                path: "/checkout/*",
                app: "acme",
                threshold: 2500,
              },
              metricValue: 1800,
              metricStatus: "verified",
              metricStatusSince: "2026-11-10T10:00:00.000Z",
              metricEvaluatedAt: "2026-11-16T10:00:00.000Z",
              metricDays: [
                { day: "2026-11-15", value: 2500, status: "verified" },
                { day: "2026-11-16", value: 1800, status: "verified" },
              ],
              status: "verified",
            })}
            releases={[{ id: 3, tag: "2.4.0" }]}
            onChange={() => {}}
            onEdit={() => {}}
            onDeleted={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const card = await screen.findByTestId("requirement-metric");
    expect(card.textContent).toContain(
      "LCP · p75 · /checkout/* · acme production · ≤ 2500 ms",
    );
    expect(card.textContent).toContain("1800 ms");
    expect(card.textContent).toContain("Verified");
    expect(card.textContent).toContain("Needs an app built with Alepha");
    expect(
      screen.getByTestId("metric-sparkline").querySelectorAll("circle"),
    ).toHaveLength(2);
  });
});
