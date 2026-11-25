import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  ElementReferenceRegistry,
  I18n,
  PinnedPromptsSlot,
} from "@lore/core/web";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import UseCasePage from "./UseCasePage.tsx";

const aUseCase = (over: Partial<UseCaseResource>): UseCaseResource =>
  ({
    id: 1,
    projectId: 1,
    number: 1,
    title: "Order as a guest",
    status: "ready",
    priority: "high",
    preconditions: "",
    scenarioVersion: 2,
    state: "never_run",
    stale: false,
    criterionSeq: 1,
    actors: [{ personaId: 10, number: 2, name: "Léa", role: "primary" }],
    steps: [
      { id: 1, position: 1, actorPersonaId: 10, text: "Opens the basket" },
      { id: 2, position: 2, text: "Computes the total" },
    ],
    alternatives: [],
    criteria: [
      {
        id: 1,
        key: "C1",
        position: 1,
        givenText: "a basket",
        whenText: "she pays",
        thenText: "an order exists",
        method: "e2e",
      },
    ],
    coveredBy: [
      {
        id: 5,
        number: 2,
        title: "Checkout",
        status: "in_progress",
        progress: { completed: 1, total: 3 },
      },
    ],
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T10:00:00.000Z",
    ...over,
  }) as UseCaseResource;

const ROWS = [
  aUseCase({}),
  aUseCase({
    id: 2,
    number: 2,
    title: "Share a wishlist",
    status: "draft",
    coveredBy: [],
  }),
];

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

/**
 * The Use cases tab and a use case's page (#E153, #Q3767).
 */
describe("Use cases screens", () => {
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

  const mount = (app: Alepha, node: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>{node}</DialogProvider>
      </AlephaContext.Provider>,
    );

  it("groups by persona on a first visit, and restores the last pick for the project (#Q3979)", async ({
    expect,
  }) => {
    const app = await boot(["usecase:read"]);
    const view = mount(app, <UseCasesPage />);
    await screen.findByText("Order as a guest");
    const groups = () =>
      [...document.querySelectorAll('[data-slot="data-table-group"]')].map(
        (row) => row.getAttribute("data-group"),
      );
    expect(groups()).toEqual(["persona:2"]);

    // A pick is kept for this project, and the page reopens on it.
    app.store.set(useCaseGroupingAtom, { byProject: { "1": "status" } });
    view.unmount();
    mount(app, <UseCasesPage />);
    await screen.findByText("Order as a guest");
    expect(groups()).toEqual(["draft", "ready"]);
  });

  it("remembers the group-by picked in the toolbar, for this project only (#Q3979)", async ({
    expect,
  }) => {
    const app = await boot(["usecase:read"]);
    app.store.set(useCaseGroupingAtom, { byProject: { "9": "none" } });
    mount(app, <UseCasesPage />);
    await screen.findByText("Order as a guest");
    // The toolbar's grouping select, the one showing the grouping in use.
    const trigger = await waitFor(() => {
      const found = [
        ...document.querySelectorAll<HTMLElement>('[role="combobox"]'),
      ].find(
        (it) => !it.getAttribute("aria-label") && it.textContent === "Persona",
      );
      if (!found) throw new Error("no group-by select");
      return found;
    });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = await waitFor(() =>
      screen.getByRole("option", { name: /Status/ }),
    );
    await act(async () => fireEvent.click(option));
    await waitFor(() =>
      expect(app.store.get(useCaseGroupingAtom).byProject).toEqual({
        "9": "none",
        "1": "status",
      }),
    );
  });

  it("groups the use cases by epic, the uncovered ones last, and collapses a group", async ({
    expect,
  }) => {
    const app = await boot(["usecase:read", "usecase:write"]);
    app.store.set(useCaseGroupingAtom, { byProject: { "1": "epic" } });
    mount(app, <UseCasesPage />);

    await screen.findByText("Order as a guest");
    // DataTable's group rows (`groupBy`), each folding its use cases.
    const groups = [
      ...document.querySelectorAll('[data-slot="data-table-group"]'),
    ];
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain("#E2 Checkout");
    expect(groups[0].textContent).toContain("1 / 3 quests");
    expect(groups[1].textContent).toContain("No epic yet");
    expect(screen.getByRole("button", { name: /New use case/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /#E2 Checkout/ }));
    await waitFor(() =>
      expect(screen.queryByText("Order as a guest")).toBeNull(),
    );
    expect(screen.getByText("Share a wishlist")).toBeTruthy();
  });

  it("offers a viewer no create control", async ({ expect }) => {
    mount(await boot(["usecase:read"]), <UseCasesPage />);
    await screen.findByText("Order as a guest");
    expect(screen.queryByRole("button", { name: /New use case/ })).toBeNull();
  });

  it("shows the scenario as Steps, then Lanes, and the criteria in Given / When / Then", async ({
    expect,
  }) => {
    mount(
      await boot(["usecase:read", "usecase:write"]),
      <UseCasePage useCase={ROWS[0]} />,
    );

    await screen.findByTestId("scenario-steps");
    expect(screen.getByTestId("criteria").textContent).toContain("Given");
    expect(screen.getByTestId("criteria").textContent).toContain(
      "an order exists",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Lanes" }));
    const lanes = await screen.findByTestId("scenario-lanes");
    expect(lanes.textContent).toContain("Léa");
    expect(lanes.textContent).toContain("System");
  });

  it("asks for validation as a writer, and answers it only with usecase:validate", async ({
    expect,
  }) => {
    mount(
      await boot(["usecase:read", "usecase:write"]),
      <UseCasePage useCase={ROWS[0]} />,
    );
    await screen.findByTestId("scenario-steps");
    expect(
      screen.getByRole("button", { name: /Request validation/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Validate$/ })).toBeNull();
  });

  it("gives a validator Validate and Request changes", async ({ expect }) => {
    mount(
      await boot(["usecase:read", "usecase:write", "usecase:validate"]),
      <UseCasePage useCase={ROWS[0]} />,
    );
    await screen.findByTestId("scenario-steps");
    expect(screen.getByRole("button", { name: /^Validate$/ })).toBeTruthy();
    // Request changes sits in the overflow menu, so the bar never crowds
    // the tabs out.
    fireEvent.click(screen.getByTestId("detail-more"));
    expect(
      await screen.findByRole("menuitem", { name: /Request changes/ }),
    ).toBeTruthy();
  });

  it("shows each actor's persona role as the persona card's badge, and nothing for an actor without one (#Q3967)", async ({
    expect,
  }) => {
    mount(
      await boot(["usecase:read"]),
      <UseCasePage
        useCase={aUseCase({
          actors: [
            {
              personaId: 10,
              number: 4,
              name: "Karim",
              role: "primary",
              alephaRole: "control_room",
            },
            { personaId: 11, number: 5, name: "Léa", role: "beneficiary" },
          ],
        })}
      />,
    );
    await screen.findByTestId("scenario-steps");
    const badges = screen.getAllByTestId("persona-alepha-role");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Control room");
    expect(badges[0].closest("li")?.textContent).toContain("Karim");
    expect(document.body.textContent).not.toContain("control_room");
  });
});
