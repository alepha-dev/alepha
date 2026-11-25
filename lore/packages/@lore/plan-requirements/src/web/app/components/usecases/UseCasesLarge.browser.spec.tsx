import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  ElementReferenceRegistry,
  I18n,
  PinnedPromptsSlot,
} from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { useCaseGroupingAtom } from "../../atoms/useCaseGroupingAtom.ts";
import UseCasesPage from "../pages/UseCasesPage.tsx";

/**
 * 276 use cases, the size of the project whose Use cases page lagged
 * (#Q3978): two epics share four in five of them, the rest are uncovered.
 */
const ROWS = Array.from(
  { length: 276 },
  (_, i) =>
    ({
      id: i + 1,
      projectId: 1,
      number: i + 1,
      title: `Scenario ${i + 1}`,
      status: "ready",
      priority: "high",
      preconditions: "",
      scenarioVersion: 1,
      state: i % 2 ? "passed" : "never_run",
      stale: false,
      criterionSeq: 1,
      actors: [],
      steps: [],
      alternatives: [],
      criteria: [],
      coveredBy:
        i % 5 === 0
          ? []
          : [
              {
                id: 1 + (i % 2),
                number: 1 + (i % 2),
                title: `Epic ${1 + (i % 2)}`,
                status: "in_progress",
                progress: { completed: 1, total: 3 },
              },
            ],
      createdAt: "2026-11-10T10:00:00.000Z",
      updatedAt: "2026-11-10T10:00:00.000Z",
    }) as unknown as UseCaseResource,
);

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getUseCases: async () => ROWS,
      getPersonas: async () => [],
      getUseCaseCoverage: async () => [],
    });
  }
}

class StubPages {
  projectUseCase = $page({
    name: "projectUseCase",
    path: "/:projectSlug/requirements/use-cases/:useCaseNumber",
    component: () => null,
  });
  projectUseCases = $page({
    name: "projectUseCases",
    path: "/:projectSlug/requirements/use-cases",
    component: () => null,
  });
}

const rowCount = () =>
  document.querySelectorAll("tbody tr[data-row-key]").length;

const groupHeaders = () =>
  [...document.querySelectorAll('[data-slot="data-table-group"]')].map((row) =>
    row.getAttribute("data-group"),
  );

describe("Use cases page at 276 use cases (#Q3978)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    // The table keeps its filters per project: a counter clicked in one
    // case must not start the next one filtered.
    localStorage.clear();
  });

  const mount = async () => {
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
      permissions: ["usecase:read"],
    } as never);
    // These cases read the epic groups; the page opens on personas.
    alepha.store.set(useCaseGroupingAtom, { byProject: { "1": "epic" } });
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <UseCasesPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findAllByTestId("use-case-row");
  };

  it("draws one page of 50 rows, while the counters count every use case", async ({
    expect,
  }) => {
    await mount();
    expect(rowCount()).toBe(50);
    expect(screen.getByText("276")).toBeTruthy();
    // Passed and Never run, 138 each.
    expect(screen.getAllByText("138")).toHaveLength(2);
  });

  it("pages group by group, each header counting its whole group", async ({
    expect,
  }) => {
    await mount();
    // Epic 2 holds 110 of the 276 (i odd, not a multiple of 5): page 1 is
    // all epic 1, under one header that counts the group, not the page.
    expect(groupHeaders()).toEqual(["epic:1"]);
    expect(
      document.querySelector('[data-group="epic:1"]')?.textContent,
    ).toContain("110");

    for (let page = 0; page < 4; page++) {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
    // Page 5 (rows 201-250): epic 2's last 20, then the uncovered ones.
    await waitFor(() =>
      expect(groupHeaders()).toEqual(["epic:2", "unplanned"]),
    );
  });

  it("filters across every page, not only the one on screen", async ({
    expect,
  }) => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Passed/ }));
    // 138 passed: page 1 still holds 50 of them.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("tbody tr[data-row-key]")].every(
          (row) => !row.textContent?.includes("Never run"),
        ),
      ).toBe(true),
    );
    expect(rowCount()).toBe(50);
  });

  it("goes back to every use case from the use cases counter (#Q3974)", async ({
    expect,
  }) => {
    await mount();
    const total = screen.getByRole("button", { name: /^use cases$/i });
    expect(total.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Passed/ }));
    await waitFor(() =>
      expect(total.getAttribute("aria-pressed")).toBe("false"),
    );
    fireEvent.click(total);
    await waitFor(() =>
      expect(total.getAttribute("aria-pressed")).toBe("true"),
    );
    // Every use case again, paged: the pager counts 276.
    expect(document.body.textContent).toContain("276");
    expect(rowCount()).toBe(50);
    expect(
      [...document.querySelectorAll("tbody tr[data-row-key]")].some((row) =>
        row.textContent?.includes("Never run"),
      ),
    ).toBe(true);
  });
});
