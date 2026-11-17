import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  ElementReferenceRegistry,
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

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import PersonasTab from "../layout/PersonasTab.tsx";
import PersonaPage from "./PersonaPage.tsx";

const aPersona = (over: Partial<PersonaResource>): PersonaResource =>
  ({
    id: 1,
    projectId: 1,
    number: 1,
    kind: "human",
    name: "Léa",
    role: "Shop manager",
    who: "Runs the Lyon shop.",
    goals: "Ship orders the same day\nKeep stock right",
    frustrations: "",
    areas: [],
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T10:00:00.000Z",
    ...over,
  }) as PersonaResource;

const PEOPLE = [
  aPersona({ alephaRole: "shop-manager" }),
  aPersona({
    id: 2,
    number: 2,
    name: "Indexer",
    kind: "system",
    role: "Search",
    goals: "Index nightly",
  }),
];

let copyState = "ready";

const CHANGES = {
  lastRunAt: "2026-11-12T10:00:00.000Z",
  useCases: 1,
  toReverify: 1,
  changes: [
    {
      questNumber: 12,
      title: "Faster checkout",
      completedAt: "2026-11-13T10:00:00.000Z",
      via: "epic",
      epicNumber: 3,
    },
  ],
  releases: [
    {
      release: { id: 1, tag: "1.2.0", title: "1.2.0" },
      quests: [
        {
          questNumber: 12,
          title: "Faster checkout",
          completedAt: "2026-11-13T10:00:00.000Z",
          via: "epic",
          epicNumber: 3,
        },
      ],
    },
  ],
};

const SHOWCASE = [
  {
    release: { id: 1, tag: "1.2.0", title: "1.2.0" },
    items: [
      {
        useCase: { number: 7, title: "Check out" },
        runId: 4,
        ranAt: "2026-11-12T10:00:00.000Z",
        stale: true,
        removed: false,
        file: {
          fileId: "00000000-0000-7000-8000-000000000001",
          name: "run.webm",
          mimeType: "video/webm",
        },
        chapters: [{ position: 1, text: "Open the cart" }],
      },
    ],
  },
];

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getPersonas: async () => PEOPLE,
      getUseCases: async () => [
        {
          id: 7,
          number: 7,
          title: "Check out",
          state: "never_run",
          stale: false,
          actors: [{ personaId: 1, role: "primary", number: 1, name: "Léa" }],
        },
      ],
      getPersonaChanges: async () => CHANGES,
      getPersonaAppCopy: async () => ({
        state: copyState,
        app: "acme",
        env: copyState === "production" ? "production" : "staging",
        url: copyState === "ready" ? "https://staging.acme.example" : undefined,
      }),
      getPersonaShowcase: async () => SHOWCASE,
    });
  }
}

/**
 * The page names the persona route; a stub carries its path.
 */
class StubPages {
  projectPersona = $page({
    name: "projectPersona",
    path: "/:projectSlug/requirements/personas/:personaNumber",
    component: () => null,
  });
  projectPersonas = $page({
    name: "projectPersonas",
    path: "/:projectSlug/requirements/personas",
    component: () => null,
  });
}

/**
 * The Personas tab and a persona's page (#E153, #Q3765): cards with the
 * kind filter, the identity card and the Overview, and no write control for
 * a reader without `persona:write`.
 */
describe("Personas screens", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    copyState = "ready";
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

  it("draws one card per persona and filters them by a search", async ({
    expect,
  }) => {
    const app = await boot(["persona:read", "persona:write"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonasTab />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await screen.findByText("Léa");
    expect(screen.getAllByTestId("persona-card")).toHaveLength(2);
    expect(screen.getByText("#A1")).toBeTruthy();
    // The first line of the goals, as the card's quote.
    expect(screen.getByText("Ship orders the same day")).toBeTruthy();
    expect(screen.getByText("shop-manager")).toBeTruthy();
    expect(screen.getAllByTestId("persona-card")[0].getAttribute("href")).toBe(
      "/acme/requirements/personas/1",
    );
    expect(screen.getByRole("button", { name: /New persona/ })).toBeTruthy();

    // The kind filter starts empty: no "All" value stands in for it.
    expect(screen.queryByRole("radio", { name: "All" })).toBeNull();
    fireEvent.change(screen.getByTestId("persona-search"), {
      target: { value: "indexer" },
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("persona-card")).toHaveLength(1),
    );
    expect(screen.getByText("Indexer")).toBeTruthy();
  });

  it("offers a viewer no create control", async ({ expect }) => {
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonasTab />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await screen.findByText("Léa");
    expect(screen.queryByRole("button", { name: /New persona/ })).toBeNull();
  });

  it("opens a persona on its identity card and its Overview", async ({
    expect,
  }) => {
    const app = await boot(["persona:read", "persona:write"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonaPage persona={PEOPLE[0]} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await screen.findByTestId("persona-overview");
    expect(screen.getAllByText("#A1").length).toBeGreaterThan(0);
    expect(screen.getByText("Who they are")).toBeTruthy();
    expect(screen.getByText("Runs the Lyon shop.")).toBeTruthy();
    // An empty section is omitted, not drawn blank.
    expect(screen.queryByText("Frustrations")).toBeNull();
    expect(screen.getByRole("button", { name: /Edit persona/ })).toBeTruthy();
  });

  it("gives a viewer the page without its Edit and Delete", async ({
    expect,
  }) => {
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonaPage persona={PEOPLE[0]} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await screen.findByTestId("persona-overview");
    expect(screen.queryByRole("button", { name: /Edit persona/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("says what is left to cover: personas with no passing use case, use cases never run (#Q3772)", async ({
    expect,
  }) => {
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonasTab />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const banner = await screen.findByTestId("to-cover-banner");
    expect(banner.textContent).toBe(
      "To cover: 2 personas with no passing use case, 1 use case never run.",
    );
  });

  it("flags a scope change, lists it, opens the app copy and shows the showcase (#Q3772)", async ({
    expect,
  }) => {
    const app = await boot(["persona:read"]);
    const opened: unknown[] = [];
    const open = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonaPage persona={PEOPLE[0]} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const banner = await screen.findByTestId("scope-changed-banner");
    expect(banner.textContent).toContain("1 use case to re-verify");
    expect(screen.getByTestId("persona-changes-card")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Open as Léa/ }));
    expect(opened).toEqual([
      ["https://staging.acme.example", "_blank", "noopener,noreferrer"],
    ]);
    window.open = open;

    fireEvent.click(screen.getByRole("button", { name: /See the changes/ }));
    await screen.findByTestId("persona-changes");
    expect(screen.getAllByTestId("persona-change")).toHaveLength(2);
    expect(screen.getAllByText("via epic #E3").length).toBe(2);
    expect(screen.getByText("What's new for Léa")).toBeTruthy();

    fireEvent.click(await screen.findByRole("radio", { name: /Showcase/ }));
    const item = await screen.findByTestId("showcase-item");
    expect(item.querySelector("video")?.getAttribute("src")).toBe(
      "/api/files/00000000-0000-7000-8000-000000000001",
    );
    expect(item.textContent).toContain("Stale");
  });

  it("refuses Open as on a production copy (#Q3772)", async ({ expect }) => {
    copyState = "production";
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonaPage persona={PEOPLE[0]} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const button = await screen.findByRole("button", { name: /Open as Léa/ });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
