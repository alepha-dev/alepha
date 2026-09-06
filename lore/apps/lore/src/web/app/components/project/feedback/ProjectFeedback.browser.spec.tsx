import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentFeedbackCountAtom } from "../../../atoms/currentFeedbackCountAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { FEEDBACK_PAGE_SIZE } from "./feedbackPageSize.ts";
import ProjectFeedback from "./ProjectFeedback.tsx";

const TOTAL = 23;

const feedbackOf = (id: number): FeedbackResource =>
  ({
    id,
    shortId: id,
    projectId: 1,
    title: `Report number ${id}`,
    description: `body ${id}`,
    status: "pending",
    createdAt: "2026-09-02T10:00:00.000Z",
    attachments: [],
    tags: [],
  }) as FeedbackResource;

// Newest first, the order the endpoint answers in.
const ALL = Array.from({ length: TOTAL }, (_, i) => feedbackOf(TOTAL - i));

/**
 * Serves the paged list the real endpoint serves, so the page boundary this
 * spec is about is computed here rather than asserted against a constant.
 * Same substitution seam as `ProjectFeedbackDetail.browser.spec.tsx`
 * (`CLAUDE.md`: never `vi.mock` / `vi.spyOn`).
 */
class FakeLinkProvider extends LinkProvider {
  listCalls: Array<{ status?: string; limit?: number; offset?: number }> = [];
  countCalls = 0;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {
        listFeedback: async (config: {
          query?: { status?: string; limit?: number; offset?: number };
        }) => {
          const query = config.query ?? {};
          this.listCalls.push(query);
          const rows = query.status === "pending" ? ALL : [];
          const offset = query.offset ?? 0;
          const limit = query.limit ?? 10;
          return {
            items: rows.slice(offset, offset + limit),
            hasMore: rows.length > offset + limit,
          };
        },
        // The whole set, never the page - which is the point of it being a
        // separate endpoint at all.
        countFeedback: async () => {
          this.countCalls += 1;
          return { count: TOTAL };
        },
      } as Record<string, unknown>,
      {
        get: (target, prop: string) =>
          target[prop] ??
          (async () => Object.assign([], { content: [], items: [] })),
      },
    );
  }
}

/**
 * The inbox pages at ten (#1744, from feedback #2076: "add LIMIT to 10 +
 * show more, it's useless to display all"). It used to render every row for
 * the selected status, which on project 1 was 106 cards in one column.
 *
 * Three things have to hold together, and each has failed in a plausible
 * first draft of this change:
 *
 * - the page boundary itself - one page, then `Show more` APPENDS rather
 *   than replaces;
 * - the selection survives a load, so pressing `Show more` does not move the
 *   detail pane out from under whoever is reading it;
 * - the sidebar badge counts the whole pending set. It used to read
 *   `items.length` off the list, which was the same number only while the
 *   list was unbounded - after paging it would sit at 10 over an inbox
 *   of 106.
 */
describe("ProjectFeedback - Show more", () => {
  beforeAll(() => {
    // The status segment measures itself with a ResizeObserver jsdom has not
    // got.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(() => {
    cleanup();
  });

  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it - `AlephaReactRouter`
      // instantiates `LinkProvider`, and a substitution after that is too
      // late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    await alepha.start();
    // The atom validates against `projectResourceSchema`, so this is the
    // whole required shape, not a convenient subset.
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    return alepha;
  };

  const view = (alepha: Alepha) =>
    render(
      <AlephaContext.Provider value={alepha}>
        {/* The detail pane calls `useDialog`, so the provider Lore's own
            `Layout.tsx` mounts has to be here too. */}
        <DialogProvider>
          <ProjectFeedback
            items={ALL.slice(0, FEEDBACK_PAGE_SIZE)}
            hasMore={TOTAL > FEEDBACK_PAGE_SIZE}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

  const titles = (root: HTMLElement) =>
    Array.from(root.querySelectorAll("aside *"))
      .filter(
        (el) =>
          el.children.length === 0 &&
          /^Report number \d+$/.test(el.textContent ?? ""),
      )
      .map((el) => el.textContent ?? "");

  it("renders one page and appends the next, keeping the selection", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const root = rendered.container as HTMLElement;

    expect(titles(root)).toHaveLength(FEEDBACK_PAGE_SIZE);
    expect(titles(root)[0]).toBe(`Report number ${TOTAL}`);

    // Select something that is NOT the first row, so a reset would show.
    // The card is a `div[role=button]`, not a `<button>`.
    const fourth = Array.from(root.querySelectorAll("aside *")).find(
      (el) => el.textContent === "Report number 20" && el.children.length === 0,
    );
    (fourth?.closest('[role="button"]') as HTMLElement | null)?.click();
    await waitFor(() =>
      expect(rendered.container.textContent).toContain("body 20"),
    );

    (await rendered.findByTestId("feedback-show-more")).click();
    await waitFor(() =>
      expect(titles(root)).toHaveLength(FEEDBACK_PAGE_SIZE * 2),
    );

    // The second page was asked for at the boundary, not from zero.
    const paged = alepha
      .inject(FakeLinkProvider)
      .listCalls.find((call) => (call.offset ?? 0) > 0);
    expect(paged?.offset).toBe(FEEDBACK_PAGE_SIZE);

    // Appended, not replaced: the first page is still there, in order, and
    // the reader's selection did not move.
    expect(titles(root)[0]).toBe(`Report number ${TOTAL}`);
    expect(new Set(titles(root)).size).toBe(titles(root).length);
    expect(rendered.container.textContent).toContain("body 20");

    // Last page: the remainder arrives and the button goes away.
    (await rendered.findByTestId("feedback-show-more")).click();
    await waitFor(() => expect(titles(root)).toHaveLength(TOTAL));
    await waitFor(() =>
      expect(rendered.queryByTestId("feedback-show-more")).toBeNull(),
    );
    expect(rendered.container.textContent).toContain("body 20");
  });

  it("counts the whole pending set for the badge, not the page", async ({
    expect,
  }) => {
    const alepha = await mount();
    view(alepha);

    await waitFor(() =>
      expect(alepha.store.get(currentFeedbackCountAtom)?.count).toBe(TOTAL),
    );
    // And it came from the dedicated count, not from measuring a page.
    expect(alepha.inject(FakeLinkProvider).countCalls).toBeGreaterThan(0);
  });
});
