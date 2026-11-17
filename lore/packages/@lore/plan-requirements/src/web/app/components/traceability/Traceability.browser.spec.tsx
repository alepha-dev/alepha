import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { readinessOf } from "../../../../api/requirementReadiness.ts";
import type { RequirementCoverage } from "../../../../api/schemas/requirementCoverageSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import CoverageGaps from "./CoverageGaps.tsx";
import ReadinessBanner from "./ReadinessBanner.tsx";
import TraceabilityMatrix from "./TraceabilityMatrix.tsx";

const REQUIREMENTS = [
  {
    id: 1,
    number: 5,
    statement: "The discount is visible",
    priority: "must",
    status: "failing",
    criteria: [{ useCaseNumber: 7, key: "C2", result: "failed" }],
    coveringEpics: [{ id: 9, number: 5, title: "Promotions" }],
    metricDays: [],
  },
  {
    id: 2,
    number: 11,
    statement: "The discounted amount is sent",
    priority: "must",
    status: "verified",
    criteria: [{ useCaseNumber: 8, key: "C1", result: "passed" }],
    coveringEpics: [{ id: 9, number: 5, title: "Promotions" }],
    metricDays: [],
  },
  {
    id: 3,
    number: 18,
    statement: "The shop answers",
    priority: "should",
    status: "verified",
    criteria: [],
    coveringEpics: [],
    metric: { kind: "availability", threshold: 99.9 },
    metricValue: 99.97,
    metricStatus: "verified",
    metricDays: [],
  },
] as unknown as RequirementResource[];

const USE_CASES = [
  {
    id: 7,
    number: 7,
    title: "Apply a code",
    state: "failed",
    stale: false,
    actors: [{ personaId: 1, number: 1, name: "Léa", role: "primary" }],
  },
  {
    id: 8,
    number: 8,
    title: "Pay",
    state: "passed",
    stale: true,
    actors: [{ personaId: 2, number: 2, name: "Karim", role: "primary" }],
  },
] as unknown as UseCaseResource[];

const COVERAGE: RequirementCoverage = {
  must: { verified: 1, total: 2 },
  should: { verified: 1, total: 1 },
  failingMust: [{ number: 5, statement: "The discount is visible" }],
  blocking: false,
  gaps: {
    requirementsNotVerified: [
      { number: 5, statement: "The discount is visible", status: "failing" },
    ],
    useCasesWithoutRequirement: [{ number: 12, title: "Export" }],
    personasWithoutPassingUseCase: [{ number: 3, name: "Inès" }],
    epicsWithoutUseCase: [{ id: 6, number: 6, title: "Postgres move" }],
  },
};

const marked: unknown[] = [];

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      setEpicTechnical: async (args: unknown) => {
        marked.push(args);
        return { ok: true };
      },
    });
  }
}

/**
 * The traceability matrix, a release's readiness and the coverage gaps
 * (#E153, #Q3774).
 */
describe("Traceability", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const boot = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture({ capabilities: ["plan"] }),
      slug: "acme",
      permissions: ["requirement:read", "requirement:write"],
    } as never);
    return alepha;
  };

  it("draws the matrix three ways, with the Metric column", async ({
    expect,
  }) => {
    const app = await boot();
    const selected: number[] = [];
    render(
      <AlephaContext.Provider value={app}>
        <TraceabilityMatrix
          requirements={REQUIREMENTS}
          useCases={USE_CASES}
          personas={
            [
              { id: 1, number: 1, name: "Léa" },
              { id: 2, number: 2, name: "Karim" },
            ] as never
          }
          onSelect={(number) => selected.push(number)}
        />
      </AlephaContext.Provider>,
    );

    const rows = await screen.findAllByTestId("matrix-row");
    expect(rows).toHaveLength(3);
    const cells = (row: HTMLElement) =>
      [...row.querySelectorAll("[data-cell]")].map((it) =>
        it.getAttribute("data-cell"),
      );
    expect(cells(rows[0])).toEqual(["failing", "none"]);
    expect(cells(rows[1])).toEqual(["none", "stale"]);
    expect(screen.getByTestId("matrix-metric").textContent).toBe("99.97%");
    fireEvent.click(rows[0]);
    expect(selected).toEqual([5]);

    fireEvent.click(screen.getByRole("radio", { name: "Requirement × Epic" }));
    await waitFor(() =>
      expect(cells(screen.getAllByTestId("matrix-row")[0])).toEqual([
        "failing",
      ]),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Persona × Use case" }));
    await waitFor(() =>
      expect(cells(screen.getAllByTestId("matrix-row")[1])).toEqual([
        "none",
        "stale",
      ]),
    );
  });

  it("says a release's readiness, warning or blocking", async ({ expect }) => {
    const app = await boot();
    render(
      <AlephaContext.Provider value={app}>
        <ReadinessBanner
          release="2.4.0"
          readiness={readinessOf(REQUIREMENTS)}
          blocks={false}
        />
      </AlephaContext.Provider>,
    );
    const banner = await screen.findByTestId("readiness-banner");
    expect(banner.textContent).toContain("Release 2.4.0 readiness");
    expect(banner.textContent).toContain("Must 1 / 2 verified");
    expect(banner.textContent).toContain("Failing Must: #S5");
    expect(banner.textContent).toContain("Warning only");
  });

  it("lists the gaps and marks an epic technical", async ({ expect }) => {
    const app = await boot();
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <CoverageGaps projectId={1} canWrite coverage={COVERAGE} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    expect((await screen.findByTestId("gap-personas")).textContent).toContain(
      "#A3 Inès",
    );
    expect(screen.getByTestId("gap-usecases").textContent).toContain("#U12");
    fireEvent.click(
      screen.getByRole("button", { name: /Mark #E6 as technical/ }),
    );
    await waitFor(() => expect(marked).toHaveLength(1));
  });
});
