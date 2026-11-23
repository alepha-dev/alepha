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
import PersonasPage from "../pages/PersonasPage.tsx";
import PersonaCard from "./PersonaCard.tsx";
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
    alephaRole: "viewer on the hub; operator on the station edge",
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

const ONE_USE_CASE = [
  {
    id: 7,
    number: 7,
    title: "Check out",
    status: "ready",
    priority: "high",
    state: "never_run",
    stale: false,
    actors: [{ personaId: 1, role: "primary", number: 1, name: "Léa" }],
    coveredBy: [],
    criteria: [],
  },
];

/**
 * What `getUseCases` answers: one use case, or a case's own list.
 */
let useCases: unknown[] = ONE_USE_CASE;

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getPersonas: async () => PEOPLE,
      getUseCases: async () => useCases,
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
  projectUseCase = $page({
    name: "projectUseCase",
    path: "/:projectSlug/requirements/use-cases/:useCaseNumber",
    component: () => null,
  });
}

/**
 * The Personas page and a persona's page (#E153, #Q3765): cards with the
 * kind filter, the identity card and the Overview, and no write control for
 * a reader without `persona:write`.
 */
describe("Personas screens", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    // The page keeps its tab in `?tab=`: a case that opened one must not
    // start the next on it.
    window.history.replaceState(null, "", "/");
    await alepha?.stop();
    alepha = undefined;
    copyState = "ready";
    useCases = ONE_USE_CASE;
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

  it("draws one card per persona and filters them by kind", async ({
    expect,
  }) => {
    const app = await boot(["persona:read", "persona:write"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonasPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await screen.findByText("Léa");
    expect(screen.getAllByTestId("persona-card")).toHaveLength(2);
    // Each kind tab counts its personas, from the one list (#Q3961).
    expect(
      ["all", "human", "system", "agent"].map(
        (kind) =>
          screen.getByTestId(`persona-filter-count-${kind}`).textContent,
      ),
    ).toEqual(["2", "1", "1", "0"]);
    // The selected tab's count takes its foreground; the others stay muted
    // (#Q3968).
    const countClass = (kind: string) =>
      screen.getByTestId(`persona-filter-count-${kind}`).className;
    expect(countClass("all")).toContain("text-primary-foreground");
    expect(countClass("human")).toContain("text-muted-foreground");
    fireEvent.click(screen.getByRole("radio", { name: /Human/ }));
    await waitFor(() =>
      expect(countClass("human")).toContain("text-primary-foreground"),
    );
    expect(countClass("all")).toContain("text-muted-foreground");
    fireEvent.click(screen.getByRole("radio", { name: /All/ }));
    await waitFor(() =>
      expect(screen.getAllByTestId("persona-card")).toHaveLength(2),
    );
    expect(screen.getByText("#A1")).toBeTruthy();
    // The first line of the goals, as the card's quote.
    expect(screen.getByText("Ship orders the same day")).toBeTruthy();
    // An identifier role is a humanized badge, not a code chip (#Q3960).
    // A sentence stays readable text, out of the header.
    expect(
      screen.getAllByTestId("persona-alepha-role").map((it) => it.textContent),
    ).toEqual([
      "Shop manager",
      "role: viewer on the hub; operator on the station edge",
    ]);
    expect(screen.queryByText("role: shop-manager")).toBeNull();
    // The name is the card's link, stretched over it.
    expect(screen.getByRole("link", { name: "Léa" }).getAttribute("href")).toBe(
      "/acme/requirements/personas/1",
    );
    expect(screen.getByRole("button", { name: /New persona/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "System 1" }));
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
          <PersonasPage />
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
    // The Alepha role reads as on the card: a badge, not code (#Q3960).
    expect(screen.getByTestId("persona-alepha-role").textContent).toBe(
      "Shop manager",
    );
    // An empty section is omitted, not drawn blank.
    expect(screen.queryByText("Frustrations")).toBeNull();
    expect(screen.getByRole("button", { name: /Edit persona/ })).toBeTruthy();
  });

  it("lists the persona's use cases in a Use cases tab, opened from the aside's coverage line (#Q3966)", async ({
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
    // The tab label counts the use cases the persona acts in.
    expect(
      await screen.findByRole("radio", { name: /Use cases \(1\)/ }),
    ).toBeTruthy();

    fireEvent.click(await screen.findByTestId("persona-coverage-link"));
    const tab = await screen.findByTestId("persona-use-cases");
    const rows = screen.getAllByTestId("persona-use-case-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("#U7 Check out");
    expect(rows[0].getAttribute("href")).toBe("/acme/requirements/use-cases/7");
    expect(tab.textContent).toContain("Primary");
  });

  it("bounds the Use cases table so a persona in about 90 use cases scrolls to the last row (#Q4209)", async ({
    expect,
  }) => {
    useCases = Array.from({ length: 90 }, (_, index) => ({
      ...(ONE_USE_CASE[0] as object),
      id: 100 + index,
      number: 100 + index,
      title: `Use case ${index + 1}`,
    }));
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonaPage persona={PEOPLE[0]} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    fireEvent.click(await screen.findByTestId("persona-coverage-link"));
    const tab = await screen.findByTestId("persona-use-cases");
    await screen.findAllByTestId("persona-use-case-row");
    // jsdom lays nothing out, so the guard is the height chain itself: the
    // table's root takes the tab's height instead of every row's, as the
    // use case list's does, and its scroller sits inside it.
    const root = tab.firstElementChild as HTMLElement;
    expect(root.className).toContain("min-h-0");
    expect(root.className).toContain("flex-1");
    expect(root.querySelector(".overflow-auto")).not.toBeNull();
    expect(tab.className).toContain("min-h-0");
  });

  it("draws the last run with its age, one passing share (red on a failure), a red failed segment and a legend (#Q3976)", async ({
    expect,
  }) => {
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonaCard
            persona={PEOPLE[0]}
            href="/acme/requirements/personas/1"
            coverage={{
              useCases: 87,
              epics: 3,
              requirements: 12,
              passed: 7,
              failed: 28,
              stale: 0,
              lastRanAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("persona-last-run").textContent).toContain(
        "2 hours ago",
      ),
    );
    expect(screen.getByTestId("persona-last-run").textContent).toContain(
      "Last run",
    );
    // 7 of the 35 run passed.
    const passing = screen.getByTestId("persona-passing");
    expect(passing.textContent).toBe("20% passing");
    expect(passing.className).toContain("text-danger-text");
    expect(
      document.querySelector('[data-segment="failed"]')?.className,
    ).toContain("bg-danger");
    expect(screen.getByTestId("persona-run-legend").textContent).toBe(
      "7 passed28 failed52 not run",
    );
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

  it("says what is left to cover: each persona with no passing use case, then the use cases never run (#Q3772)", async ({
    expect,
  }) => {
    const app = await boot(["persona:read"]);
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <PersonasPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    // Folded: the counts.
    const banner = await screen.findByTestId("to-cover-banner");
    expect(banner.textContent).toBe(
      "To cover2 personas with no passing use case · 1 use case never run",
    );
    expect(screen.queryByTestId("to-cover-list")).toBeNull();

    // Opened: every item, each a link to its page.
    fireEvent.click(screen.getByTestId("to-cover-toggle"));
    const items = [
      ...screen.getByTestId("to-cover-list").querySelectorAll("li"),
    ].map((it) => it.textContent);
    expect(items).toEqual([
      "#A1 Léa has no passing use case",
      "#A2 Indexer has no passing use case",
      "#U7 Check out has never run",
    ]);
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
