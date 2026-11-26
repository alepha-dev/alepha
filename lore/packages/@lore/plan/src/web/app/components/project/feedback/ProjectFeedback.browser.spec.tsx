import { DialogProvider } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, PinnedPromptsSlot } from "@lore/core/web";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, QueryCache } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";
import { currentFeedbackCountAtom } from "../../../atoms/currentFeedbackCountAtom.ts";
import { feedbackListWidthAtom } from "../../../atoms/feedbackListWidthAtom.ts";
import { WorkShell } from "../../../shell/WorkShell.ts";
import { FEEDBACK_PAGE_SIZE } from "./feedbackPageSize.ts";
import ProjectFeedback from "./ProjectFeedback.tsx";
import ProjectFeedbackEmptyState from "./ProjectFeedbackEmptyState.tsx";

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
    untrusted: false,
    attachments: [],
    tags: [],
  }) as FeedbackResource;

// Newest first, the order the endpoint answers in.
const ALL = Array.from({ length: TOTAL }, (_, i) => feedbackOf(TOTAL - i));

/**
 * A promoted item: `accepted`, so it is on no page of the inbox's default
 * `pending` list however far you press Show more. This is the row a link
 * from a quest names, and the reason the address has to resolve an item the
 * page has not loaded rather than look one up among the rows it has.
 */
const ACCEPTED = { ...feedbackOf(99), status: "accepted" } as FeedbackResource;

/**
 * Serves the paged list the real endpoint serves, so the page boundary this
 * spec is about is computed here rather than asserted against a constant.
 * Same substitution seam as `ProjectFeedbackDetail.browser.spec.tsx`
 * (`AGENTS.md`: never `vi.mock` / `vi.spyOn`).
 */
class FakeLinkProvider extends LinkProvider {
  listCalls: Array<{ status?: string; limit?: number; offset?: number }> = [];
  byShortIdCalls: number[] = [];
  countCalls = 0;
  /**
   * A status whose list answers only when released, to hold a read in
   * flight while another status is picked.
   */
  held?: { status: string; release: Promise<void> };

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {
        listFeedback: async (config: {
          query?: { status?: string; limit?: number; offset?: number };
        }) => {
          const query = config.query ?? {};
          this.listCalls.push(query);
          const held = this.held;
          if (held && held.status === query.status) {
            await held.release;
          }
          const rows =
            query.status === "pending"
              ? ALL
              : query.status === "accepted"
                ? [ACCEPTED]
                : [];
          const offset = query.offset ?? 0;
          const limit = query.limit ?? 10;
          return {
            items: rows.slice(offset, offset + limit),
            hasMore: rows.length > offset + limit,
          };
        },
        getFeedbackByShortId: async (config: {
          params?: { shortId?: number };
        }) => {
          this.byShortIdCalls.push(config.params?.shortId ?? 0);
          if (config.params?.shortId === ACCEPTED.shortId) return ACCEPTED;
          throw new Error("Feedback not found");
        },
        // The whole set, never the page - which is the point of it being a
        // separate endpoint at all.
        countFeedback: async () => {
          this.countCalls += 1;
          return { count: TOTAL };
        },
      } as Record<string, unknown>,
      {
        // Every action answers `can()`, as the real client's do: the
        // detail's comment editor asks it of each element kind's upload.
        get: (target, prop: string) =>
          Object.assign(
            target[prop] ??
              (async () => Object.assign([], { content: [], items: [] })),
            { can: () => true },
          ),
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
/**
 * The observers the list's end is watched by, so a case can bring it into
 * view: jsdom lays nothing out, so nothing ever intersects on its own.
 */
const watching: Array<{
  callback: (entries: Array<{ isIntersecting: boolean }>) => void;
  live: boolean;
}> = [];

const scrollToEnd = async (_rendered: unknown) => {
  await waitFor(() => {
    if (!watching.some((it) => it.live)) throw new Error("end not watched");
  });
  await act(async () => {
    for (const it of watching.filter((entry) => entry.live)) {
      it.callback([{ isIntersecting: true }]);
    }
  });
};

describe("ProjectFeedback - loading more at the end of the list", () => {
  beforeAll(() => {
    // The status segment measures itself with a ResizeObserver jsdom has not
    // got.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    (globalThis as any).IntersectionObserver = class {
      entry: (typeof watching)[number];
      constructor(callback: (typeof watching)[number]["callback"]) {
        this.entry = { callback, live: false };
        watching.push(this.entry);
      }
      observe() {
        this.entry.live = true;
      }
      unobserve() {}
      disconnect() {
        this.entry.live = false;
      }
    };
  });

  afterEach(() => {
    cleanup();
    // jsdom shares one `location` across the whole file, and the page writes
    // the open item into the URL now, so a card clicked in one test would
    // still be the addressed item when the next one mounts.
    window.history.replaceState({}, "", "/");
  });

  /**
   * The one route this page navigates to. It writes the open item into the
   * URL as `?feedback=<shortId>` (#Q2077), and `router.push` resolves a name
   * against the registered pages - an unregistered one falls through to the
   * plain-path overload and navigates somewhere meaningless.
   */
  class Routes {
    feedback = $page({
      name: "projectFeedback",
      path: "/:projectSlug/feedback",
      component: () => null,
    });
    // The header's "+" links to the form (#Q4449).
    request = $page({
      name: "projectFeedbackRequest",
      path: "/:projectSlug/request",
      component: () => null,
    });
  }

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
    alepha.inject(Routes);
    // Work registers the agent prompt kinds the page offers (#E75, #Q2624).
    alepha.inject(WorkShell);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    // The atom validates against `projectResourceSchema`, so this is the
    // whole required shape, not a convenient subset.
    alepha.store.set(currentProjectAtom, projectFixture());
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

  /**
   * The cards' titles, without the `#P<n> - ` each one leads with (#Q3574).
   */
  const titles = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('aside [title^="#P"]')).map((el) =>
      (el.textContent ?? "").replace(/^#P\d+ - /, ""),
    );

  it("renders one page and appends the next, keeping the selection", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const root = rendered.container as HTMLElement;

    expect(titles(root)).toHaveLength(FEEDBACK_PAGE_SIZE);
    expect(titles(root)[0]).toBe(`Report number ${TOTAL}`);
    // The card leads with the number, as a quest's and an epic's do (#Q3574).
    expect(root.querySelector('aside [title^="#P"]')?.textContent).toBe(
      `#P${TOTAL} - Report number ${TOTAL}`,
    );

    // Select something that is NOT the first row, so a reset would show.
    // The card is a `div[role=button]`, not a `<button>`.
    const fourth = root.querySelector(
      'aside [title="#P20 - Report number 20"]',
    );
    (fourth?.closest('[role="button"]') as HTMLElement | null)?.click();
    await waitFor(() =>
      expect(rendered.container.textContent).toContain("body 20"),
    );

    await scrollToEnd(rendered);
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

    // Last page: the remainder arrives and the end stops being watched.
    await scrollToEnd(rendered);
    await waitFor(() => expect(titles(root)).toHaveLength(TOTAL));
    await waitFor(() =>
      expect(rendered.queryByTestId("feedback-more-sentinel")).toBeNull(),
    );
    // No button anywhere (#Q3969).
    expect(rendered.queryByTestId("feedback-show-more")).toBeNull();
    expect(rendered.container.textContent).toContain("body 20");
  });

  /**
   * The address, and the case it exists for.
   *
   * A quest promoted from feedback links to `?feedback=<shortId>`, and the
   * item it names is `accepted` by definition while the inbox opens on
   * `pending` - so the number can never be found among the rows on screen.
   * The page has to fetch it, show it, and move the filter to where it
   * lives, or the reader lands on a detail pane whose row is nowhere.
   */
  it("opens an addressed item that is on no page of the current filter", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const router = alepha.inject(ReactRouter);

    await waitFor(() =>
      expect(rendered.container.textContent).toContain(`body ${TOTAL}`),
    );

    const feedbackPath = router.path("projectFeedback", {
      params: { projectSlug: "lore" },
    }) as `/${string}`;
    await router.push(feedbackPath, {
      query: { feedback: String(ACCEPTED.shortId) },
    });

    // The item itself, fetched rather than found.
    await waitFor(() =>
      expect(rendered.container.textContent).toContain(
        `body ${ACCEPTED.shortId}`,
      ),
    );
    expect(alepha.inject(FakeLinkProvider).byShortIdCalls).toContain(
      ACCEPTED.shortId,
    );

    // And the filter followed it, so the row it came for is in the list
    // beside the pane rather than nowhere on screen.
    await waitFor(() =>
      expect(
        alepha
          .inject(FakeLinkProvider)
          .listCalls.some((call) => call.status === "accepted"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(titles(rendered.container as HTMLElement)).toEqual([
        `Report number ${ACCEPTED.shortId}`,
      ]),
    );
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

  it("mounts on the loader's first page without asking for the list", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    expect(titles(rendered.container as HTMLElement)).toHaveLength(
      FEEDBACK_PAGE_SIZE,
    );
    await waitFor(() =>
      expect(alepha.store.get(currentFeedbackCountAtom)?.count).toBe(TOTAL),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(alepha.inject(FakeLinkProvider).listCalls).toEqual([]);
  });

  it("resizes the list by its right edge, keeps the width in its atom, and resets on a double click (#Q4325)", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const pane = await rendered.findByTestId("feedback-list-pane");
    const width = () => pane.style.getPropertyValue("--feedback-list-width");
    expect(width()).toBe("380px");

    const handle = rendered.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    await waitFor(() => expect(width()).toBe("396px"));
    expect(alepha.store.get(feedbackListWidthAtom)).toEqual({ width: 396 });

    fireEvent.doubleClick(handle);
    await waitFor(() => expect(width()).toBe("380px"));
    // Held to its bounds: a step past the minimum stops at it.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        fireEvent.keyDown(handle, { key: "ArrowLeft" });
      });
    }
    expect(width()).toBe("320px");
  });

  it("shows the status filter with no visible label, named by its aria-label (#Q4324)", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const trigger = await rendered.findByTestId("feedback-status-filter");
    expect(trigger.getAttribute("aria-label")).toBe("feedback.filter.label");
    const band = trigger.closest("span")?.parentElement as HTMLElement;
    expect(band.querySelector("label")).toBeNull();
    expect(band.textContent ?? "").not.toMatch(/status\s*\*/i);
  });

  it("spaces the header band with one value: 32px controls, 12px padding and gaps (#Q4449)", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const trigger = await rendered.findByTestId("feedback-status-filter");
    const band = trigger.closest("span")?.parentElement as HTMLElement;
    // (56 - 32) / 2 = 12: `px-3` is the inset above, below and to the left
    // of a 32px control, and `gap-3` the space between the controls.
    expect(band.className).toMatch(/\bh-14\b/);
    expect(band.className).toMatch(/\bpx-3\b/);
    expect(band.className).toMatch(/\bgap-3\b/);
    expect(trigger.className).toMatch(/\bh-8\b/);
    // The robot and the bell draw nothing in this harness (an unfilled slot,
    // no subscription rows); both are `size="icon"` buttons too, 32px.
    expect(rendered.getByTestId("feedback-open-form").className).toMatch(
      /\bsize-8\b/,
    );
  });

  it("links the header's + to the feedback form, as a real anchor (#Q4449)", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = view(alepha);
    const plus = await rendered.findByTestId("feedback-open-form");
    expect(plus.tagName).toBe("A");
    expect(plus.getAttribute("href")).toBe("/lore/request");
    expect(plus.getAttribute("aria-label")).toBe("feedback.list.openForm");
  });

  it("offers no form link in the empty Pending pane: the header's + is it (#Q4449)", async ({
    expect,
  }) => {
    const alepha = await mount();
    const rendered = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectFeedbackEmptyState status="pending" hasItems={false} />
      </AlephaContext.Provider>,
    );
    expect(
      rendered.getByText("feedback.empty.detail.pending.title"),
    ).toBeTruthy();
    expect(rendered.container.querySelector("a")).toBeNull();
    expect(rendered.container.querySelector("button")).toBeNull();
  });

  it("a status picked while another loads supersedes it", async ({
    expect,
  }) => {
    const alepha = await mount();
    const fake = alepha.inject(FakeLinkProvider);
    const rendered = view(alepha);
    const root = rendered.container as HTMLElement;
    // The status is a select (#Q4289). No locale is loaded here, so a label
    // renders as its key.
    const segment = async (label: string) => {
      const trigger = await rendered.findByTestId("feedback-status-filter");
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      fireEvent.click(await rendered.findByRole("option", { name: label }));
    };

    let release: () => void = () => {};
    fake.held = {
      status: "rejected",
      release: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    await act(async () => segment("feedback.filter.rejected"));
    await waitFor(() =>
      expect(fake.listCalls.some((call) => call.status === "rejected")).toBe(
        true,
      ),
    );
    await act(async () => segment("feedback.filter.accepted"));
    await waitFor(() =>
      expect(titles(root)).toEqual([`Report number ${ACCEPTED.shortId}`]),
    );

    // The rejected list, empty, lands late and changes nothing.
    await act(async () => release());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(titles(root)).toEqual([`Report number ${ACCEPTED.shortId}`]);
  });

  it("reloads the pages it had after a triage, instead of falling back to the first", async ({
    expect,
  }) => {
    const alepha = await mount();
    const fake = alepha.inject(FakeLinkProvider);
    const rendered = view(alepha);
    const root = rendered.container as HTMLElement;

    await scrollToEnd(rendered);
    await waitFor(() =>
      expect(titles(root)).toHaveLength(FEEDBACK_PAGE_SIZE * 2),
    );
    fake.listCalls = [];

    // What `onChanged` does after a triage.
    await act(async () =>
      alepha.inject(QueryCache).invalidate(["feedback-list"]),
    );
    await waitFor(() => expect(fake.listCalls).toHaveLength(2));
    expect(fake.listCalls.map((call) => call.offset ?? 0)).toEqual([
      0,
      FEEDBACK_PAGE_SIZE,
    ]);
    expect(titles(root)).toHaveLength(FEEDBACK_PAGE_SIZE * 2);
  });
});
