import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { type Page, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import type { ProjectActivityRow } from "@/api/schemas/projectActivityRowSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectActivityPage, {
  type ProjectActivityPageProps,
} from "./ProjectActivityPage.tsx";

/**
 * Answers the three calls the page makes and records the activity query it
 * was asked with, so a case can assert both what rendered and what was
 * requested. Substitution rather than `vi.mock`, per CLAUDE.md.
 */
class FakeLinkProvider extends LinkProvider {
  public rows: ProjectActivityRow[] = [];
  public lastQuery: Record<string, unknown> | undefined;
  /**
   * The project's members. One by default, which is the case the people
   * filter hides itself for.
   */
  public people: Array<{ id: string; username: string }> = [
    { id: ACTOR, username: "feunard" },
  ];
  public usersCalls = 0;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async (input: any) => {
          if (prop === "getProjectActivity") {
            this.lastQuery = input?.query;
            return page(this.rows);
          }
          if (prop === "getProjectUsers") {
            this.usersCalls++;
            return this.people;
          }
          if (prop === "getProjectActivityFilters") {
            return { types: ["quest", "folio"], actions: ["create", "update"] };
          }
          return {};
        },
      },
    );
  }
}

const ACTOR = "00000000-0000-4000-8000-000000000009";
const SECOND = "00000000-0000-4000-8000-000000000010";

const page = (rows: ProjectActivityRow[]): Page<ProjectActivityRow> => ({
  content: rows,
  page: {
    number: 0,
    size: 25,
    offset: 0,
    numberOfElements: rows.length,
    totalElements: rows.length,
    totalPages: 1,
    isEmpty: rows.length === 0,
    isFirst: true,
    isLast: true,
  },
});

/**
 * Only the routes the rows link to. The real `AppRouter` is not mounted:
 * these cases are about the table, not about the route table.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/:projectSlug/quests/:shortId",
    component: () => null,
  });
  folio = $page({
    name: "projectFoliosFolio",
    path: "/:projectSlug/folios/:shortId",
    component: () => null,
  });
}

const row = (over: Partial<ProjectActivityRow>): ProjectActivityRow =>
  ({
    id: "1",
    createdAt: "2026-09-02T10:00:00.000Z",
    type: "quest",
    action: "create",
    userId: ACTOR,
    actor: "feunard",
    resourceType: "quest",
    resourceId: "1",
    description: "Wire it",
    ...over,
  }) as ProjectActivityRow;

describe("ProjectActivityPage", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (
    rows: ProjectActivityRow[],
    people?: Array<{ id: string; username: string }>,
    props: ProjectActivityPageProps = {},
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it: `AlephaReactRouter`
      // instantiates `LinkProvider`, and a substitution after that is too
      // late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    alepha.inject(FakeLinkProvider).rows = rows;
    if (people) {
      alepha.inject(FakeLinkProvider).people = people;
    }
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ title: "Alepha", slug: "alepha" }) as never,
    );

    return render(
      <AlephaContext.Provider value={alepha}>
        <ProjectActivityPage {...props} />
      </AlephaContext.Provider>,
    );
  };

  it("asks the server for the newest rows first", async ({ expect }) => {
    await show([row({})]);

    await waitFor(() => {
      expect(alepha!.inject(FakeLinkProvider).lastQuery).toBeDefined();
    });
    // The whole reason this page stopped being a hand-rolled feed: sorting
    // is the server's job, so the default has to reach it.
    expect(alepha!.inject(FakeLinkProvider).lastQuery?.sort).toBe("-createdAt");
  });

  it("sends a fixed resource scope for an embedded activity table", async ({
    expect,
  }) => {
    await show([], undefined, {
      resource: { type: "epic", id: "7" },
      persistenceKey: "lor.activity.1.epic.7",
    });

    await waitFor(() => {
      expect(alepha!.inject(FakeLinkProvider).lastQuery).toMatchObject({
        resourceType: "epic",
        resourceId: "7",
      });
    });
  });

  it("sends a picked filter to the server rather than narrowing rows in the browser", async ({
    expect,
  }) => {
    const screen = await show([row({})]);

    await waitFor(() => {
      expect(screen.getByText("Wire it")).toBeTruthy();
    });

    // Filters are indexed columns now. A page that narrowed client-side
    // would be filtering one page of results and calling it a filter.
    const query = alepha!.inject(FakeLinkProvider).lastQuery;
    expect(query).toHaveProperty("type");
    expect(query).toHaveProperty("action");
    expect(query).toHaveProperty("userId");
  });

  it("links a row to the page its resource is addressed by", async ({
    expect,
  }) => {
    const screen = await show([
      row({ type: "quest", resourceId: "7", description: "A quest happened" }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("A quest happened")).toBeTruthy();
    });
    expect(screen.getByText("A quest happened").closest("button")).toBeTruthy();
  });

  it("does not link a deletion", async ({ expect }) => {
    const screen = await show([
      row({
        type: "quest",
        action: "delete",
        resourceId: "7",
        description: "A deleted quest",
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText(/A deleted quest/)).toBeTruthy();
    });
    // The row is a record of what happened, so the title survives — but the
    // page behind it does not, and a link to a 404 is worse than no link.
    expect(screen.getByText(/A deleted quest/).closest("button")).toBeNull();
  });

  /**
   * A coalesced burst (#1872). Ten edits to one folio in twenty minutes used
   * to be ten near-identical rows, and a reader learned nothing from the
   * ninth. `$audit`'s `coalesce` folds them on the write side, so the feed
   * has to say how many the row stands for - otherwise it reads as one edit
   * and the other nine have silently vanished.
   */
  it("prints the count on a row that stands for several events", async ({
    expect,
  }) => {
    const screen = await show([
      row({
        action: "update",
        eventCount: 10,
        updatedAt: "2026-09-02T10:23:00.000Z",
        description: "An edited quest",
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("update")).toBeTruthy();
    });
    expect(screen.getByText("×10")).toBeTruthy();
  });

  it("says nothing about a count on an ordinary single event", async ({
    expect,
  }) => {
    // `eventCount` is 1 on every row an app that never opted in writes, so a
    // badge here would be permanent noise on most feeds.
    const screen = await show([row({ action: "create", eventCount: 1 })]);

    await waitFor(() => {
      expect(screen.getByText("create")).toBeTruthy();
    });
    expect(screen.queryByText(/^×/)).toBeNull();
  });

  /**
   * Feedback #P2178: on a project with one member the people dropdown lists
   * the owner alone, so it can only ever select every row.
   */
  describe("the people filter", () => {
    const TWO = [
      { id: ACTOR, username: "feunard" },
      { id: SECOND, username: "second" },
    ];

    /**
     * The filters the add menu offers, by label. Every filter on this page is
     * optional, so none is on the bar until it is added (#E58), and the menu
     * is where "offered" is decided.
     */
    const offered = async (
      screen: Awaited<ReturnType<typeof show>>,
    ): Promise<string[]> => {
      fireEvent.keyDown(screen.getByRole("button", { name: "Add filter" }), {
        key: "ArrowDown",
      });
      const menu = await screen.findByRole("menu");
      return within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent ?? "");
    };

    it("is not offered on a one-member project", async ({ expect }) => {
      const screen = await show([row({})]);

      await waitFor(() => {
        expect(screen.getByText("Wire it")).toBeTruthy();
        expect(alepha!.inject(FakeLinkProvider).usersCalls).toBe(1);
      });
      const items = await offered(screen);
      expect(items.some((item) => item.startsWith("Resource"))).toBe(true);
      expect(items.some((item) => item.startsWith("Who"))).toBe(false);
    });

    it("is offered from two members up", async ({ expect }) => {
      const screen = await show([row({})], TWO);

      await waitFor(async () => {
        const items = await offered(screen);
        expect(items.some((item) => item.startsWith("Who"))).toBe(true);
      });
    });

    /**
     * ⚠️ The opposite of what this page used to do, on purpose (#E58). A
     * person stored while the project had two members used to be dropped by
     * the fetch while the filter was hidden, because it would otherwise
     * narrow the table with nothing on screen to clear it. The bar now draws
     * a hidden filter that holds a value, which removes that danger where it
     * starts: the filter applies, and it is on screen to be cleared.
     */
    it("applies a stored person while it is hidden, and draws it so it can be cleared", async ({
      expect,
    }) => {
      window.localStorage.setItem(
        "lor.activity.1.filters",
        JSON.stringify({ userId: SECOND }),
      );
      const screen = await show([row({})]);

      await waitFor(() => {
        expect(alepha!.inject(FakeLinkProvider).lastQuery?.userId).toBe(SECOND);
      });
      await waitFor(() => {
        expect(
          screen.container.querySelector('[data-filter="userId"]'),
        ).not.toBeNull();
      });
      expect(
        screen.getByRole("button", { name: "Clear value: Who" }),
      ).toBeTruthy();
    });

    it("applies a stored person once the filter is shown", async ({
      expect,
    }) => {
      window.localStorage.setItem(
        "lor.activity.1.filters",
        JSON.stringify({ userId: SECOND }),
      );
      await show([row({})], TWO);

      await waitFor(() => {
        expect(alepha!.inject(FakeLinkProvider).lastQuery?.userId).toBe(SECOND);
      });
    });

    it("decides from the member list the page already fetches", async ({
      expect,
    }) => {
      const screen = await show([row({})], TWO);

      await waitFor(async () => {
        const items = await offered(screen);
        expect(items.some((item) => item.startsWith("Who"))).toBe(true);
      });
      expect(alepha!.inject(FakeLinkProvider).usersCalls).toBe(1);
    });
  });
});
