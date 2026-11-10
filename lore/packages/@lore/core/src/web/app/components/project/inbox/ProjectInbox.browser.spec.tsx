import { inboxUnreadAtom } from "@alepha/ui/shell";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, QueryCache } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import ProjectInbox from "./ProjectInbox.tsx";

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

describe("ProjectInbox - Load more", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  class Routes {
    inbox = $page({
      name: "projectInbox",
      path: "/:projectSlug/inbox",
      component: () => null,
    });
  }

  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture());
    const tree = () => (
      <AlephaContext.Provider value={alepha}>
        <ProjectInbox />
      </AlephaContext.Provider>
    );
    const rendered = render(tree());
    // The page reads `?scope=` from the router at render; outside a routed
    // layout nothing re-renders it on a navigation, so the spec does.
    const navigate = async (query?: Record<string, string>) => {
      const router = alepha.inject(ReactRouter);
      await act(async () => {
        await router.push(
          router.path("projectInbox", {
            params: { projectSlug: "lore" },
          }) as `/${string}`,
          query ? { query } : {},
        );
      });
      rendered.rerender(tree());
    };
    return {
      alepha,
      rendered,
      navigate,
      fake: alepha.inject(FakeLinkProvider),
    };
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
    const { alepha, fake, navigate, rendered } = await mount();
    const root = rendered.container as HTMLElement;

    // All projects: the read that speaks for the bell.
    await navigate({ scope: "all" });
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

  it("a scope change starts again from the first page, and a scoped read never writes the bell", async ({
    expect,
  }) => {
    const { alepha, fake, navigate, rendered } = await mount();
    const root = rendered.container as HTMLElement;

    await navigate({ scope: "all" });
    await waitFor(() => expect(loaded(alepha, "all")).toBe(PAGE_SIZE));
    await act(async () => loadMoreButton(root)?.click());
    await waitFor(() => expect(loaded(alepha, "all")).toBe(TOTAL));

    alepha.store.set(inboxUnreadAtom, { count: 7 });
    fake.calls = [];
    await navigate();
    await waitFor(() =>
      expect(root.textContent).not.toContain("Message number 4"),
    );
    expect(root.textContent).toContain("Message number 3");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.cursor).toBe(undefined);
    expect(fake.calls[0]?.scope).toMatch(/^project:/);
    expect(alepha.store.get(inboxUnreadAtom)?.count).toBe(7);
  });
});
