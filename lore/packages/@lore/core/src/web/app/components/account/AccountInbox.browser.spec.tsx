import { inboxUnreadAtom } from "@alepha/ui/shell";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, QueryCache } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import AccountInbox from "./AccountInbox.tsx";

const PAGE_SIZE = 25;
const TOTAL = 30;

const message = (n: number) => ({
  id: `m${n}`,
  title: `Message number ${n}`,
  href: "/somewhere",
  // Newest first: message 1 is the latest.
  createdAt: `2026-09-01T00:00:${String(60 - n).padStart(2, "0")}.000Z`,
});

const ALL = Array.from({ length: TOTAL }, (_, i) => message(i + 1));

/**
 * The inbox endpoint, paged by cursor as the real controller pages: the
 * cursor is the id of the last row of the page, and the next page starts
 * after it. Same substitution seam as `ProjectFeedback.browser.spec.tsx`.
 */
class FakeLinkProvider extends LinkProvider {
  calls: Array<{ scope?: string; cursor?: string; limit?: number }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {
        listInbox: async (config: {
          query?: { scope?: string; cursor?: string; limit?: number };
        }) => {
          const query = config.query ?? {};
          this.calls.push(query);
          const rows = query.scope ? ALL.slice(0, 3) : ALL;
          const start = query.cursor
            ? rows.findIndex((row) => row.id === query.cursor) + 1
            : 0;
          const items = rows.slice(start, start + (query.limit ?? PAGE_SIZE));
          const last = items[items.length - 1];
          return {
            items,
            nextCursor:
              last && start + items.length < rows.length ? last.id : undefined,
            unreadCount: query.scope ? 3 : TOTAL,
          };
        },
      } as Record<string, unknown>,
      {
        get: (target, prop: string) => target[prop] ?? (async () => ({})),
      },
    );
  }
}

describe("AccountInbox - Load more and the Project filter", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    await alepha.start();
    // The Project filter's options, as the layout's loader leaves them.
    alepha.store.set(userProjectsAtom, {
      projects: [
        {
          ...projectFixture({ id: 7, title: "Lore", slug: "lore" }),
          areaCount: 0,
          openQuestCount: 0,
          owner: true,
          lastActivityAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      totalCount: 1,
      ownedCount: 1,
      maxProjects: 50,
      canCreate: true,
    } as never);
    const rendered = render(
      <AlephaContext.Provider value={alepha}>
        <AccountInbox />
      </AlephaContext.Provider>,
    );
    return {
      alepha,
      rendered,
      fake: alepha.inject(FakeLinkProvider),
    };
  };

  /**
   * Narrow the list to one project, through the Project filter.
   */
  const pickProject = async (title: string) => {
    const trigger = await waitFor(() =>
      screen.getByRole("combobox", { name: "inbox.filter.project" }),
    );
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = await waitFor(() =>
      screen.getByRole("option", { name: title }),
    );
    await act(async () => fireEvent.click(option));
  };

  /**
   * The rows loaded under a scope's key. Counted in the cache rather than in
   * the DOM: the table shows a screenful of what it holds.
   */
  const loaded = (alepha: Alepha, scope: string) =>
    (
      alepha.inject(QueryCache).get(["inbox", scope])?.data as
        | { pages: Array<{ items: unknown[] }> }
        | undefined
    )?.pages.flatMap((page) => page.items).length ?? 0;

  const loadMoreButton = (root: HTMLElement) =>
    Array.from(root.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "inbox.loadMore",
    );

  it("renders one page, and Load more appends the next with the cursor of the last", async ({
    expect,
  }) => {
    const { alepha, fake, rendered } = await mount();
    const root = rendered.container as HTMLElement;

    // All projects, the default: the read that speaks for the bell.
    await waitFor(() => expect(loaded(alepha, "all")).toBe(PAGE_SIZE));
    expect(root.textContent).toContain("Message number 1");
    expect(fake.calls.at(-1)?.scope).toBe(undefined);
    expect(alepha.store.get(inboxUnreadAtom)?.count).toBe(TOTAL);

    fake.calls = [];
    await act(async () => loadMoreButton(root)?.click());
    await waitFor(() => expect(loaded(alepha, "all")).toBe(TOTAL));
    expect(fake.calls).toEqual([{ limit: PAGE_SIZE, cursor: `m${PAGE_SIZE}` }]);
    await waitFor(() => expect(loadMoreButton(root)).toBe(undefined));
  });

  it("a project picked starts again from the first page, and a scoped read never writes the bell", async ({
    expect,
  }) => {
    const { alepha, fake, rendered } = await mount();
    const root = rendered.container as HTMLElement;

    await waitFor(() => expect(loaded(alepha, "all")).toBe(PAGE_SIZE));
    await act(async () => loadMoreButton(root)?.click());
    await waitFor(() => expect(loaded(alepha, "all")).toBe(TOTAL));

    alepha.store.set(inboxUnreadAtom, { count: 7 });
    fake.calls = [];
    await pickProject("Lore");
    await waitFor(() =>
      expect(root.textContent).not.toContain("Message number 4"),
    );
    expect(root.textContent).toContain("Message number 3");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.cursor).toBe(undefined);
    expect(fake.calls[0]?.scope).toBe("project:7");
    expect(alepha.store.get(inboxUnreadAtom)?.count).toBe(7);
  });
});
