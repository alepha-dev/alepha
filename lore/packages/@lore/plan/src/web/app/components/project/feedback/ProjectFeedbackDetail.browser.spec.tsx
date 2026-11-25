import { DialogProvider } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n, PinnedPromptsSlot } from "@lore/core/web";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { beforeAll, describe, it } from "vitest";

import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";
import { WorkShell } from "../../../shell/WorkShell.ts";
import ProjectFeedbackDetail from "./ProjectFeedbackDetail.tsx";

/**
 * Stands in for the HTTP-backed `useClient()` calls this pane and its
 * thread make. Same substitution seam as
 * `QuestDependencyPicker.browser.spec.tsx` (`AGENTS.md`: never
 * `vi.mock` / `vi.spyOn`).
 */
class FakeLinkProvider extends LinkProvider {
  accepted: number[] = [];
  trusted: number[] = [];

  /**
   * A Proxy rather than a literal: opening the create-a-quest sheet mounts
   * `QuestCreate` and its pickers, which call several actions this test
   * has no opinion about. Answering all of them with an empty list keeps
   * the fake from being a list of whatever the sheet happens to render
   * today.
   */
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {
        acceptFeedback: async (config: { params: { feedbackId: number } }) => {
          this.accepted.push(config.params.feedbackId);
          return { ok: true };
        },
        trustFeedback: async (config: { params: { feedbackId: number } }) => {
          this.trusted.push(config.params.feedbackId);
          return { trustedAt: "2026-11-23T20:00:00.000Z" };
        },
      } as Record<string, unknown>,
      {
        get: (target, prop: string) => {
          const own = target[prop] as any;
          if (own) {
            own.can ??= () => true;
            return own;
          }
          // An empty array carrying `content` / `items` so it satisfies
          // callers that map the response and callers that unwrap a page,
          // without this fake having to know which is which.
          const fallback: any = async () =>
            Object.assign([], { content: [], items: [] });
          fallback.can = () => true;
          return fallback;
        },
      },
    );
  }
}

const pendingFeedback: FeedbackResource = {
  id: 42,
  shortId: 1,
  projectId: 1,
  title: "The button does nothing",
  description: "Clicking Save is a no-op.",
  status: "pending",
  createdAt: "2026-08-26T10:00:00.000Z",
  untrusted: false,
  attachments: [],
  tags: [],
};

const withAttachments: FeedbackResource = {
  ...pendingFeedback,
  attachmentUrls: [
    {
      id: "00000000-0000-4000-8000-00000000000a",
      name: "screenshot.png",
      url: "/api/files/00000000-0000-4000-8000-00000000000a",
      mimeType: "image/png",
      size: 20480,
    },
    {
      id: "00000000-0000-4000-8000-00000000000b",
      name: "server.log",
      url: "/api/files/00000000-0000-4000-8000-00000000000b",
      mimeType: "text/plain",
      size: 4096,
    },
  ],
} as FeedbackResource;

/**
 * Regression guard for the stale pending row: accepting from this pane
 * commits the triage immediately and then opens the create-a-quest sheet.
 * Only the sheet's SUBMIT path used to notify the list, so dismissing the
 * sheet instead left the row reading `pending` against a feedback the
 * server had already accepted - and pressing Accept again answered
 * "already triaged".
 */
describe("ProjectFeedbackDetail - accept then dismiss", () => {
  /**
   * jsdom implements no `ResizeObserver`, and the create-a-quest sheet
   * mounts `@alepha/ui`'s segmented control, which measures itself with
   * one. Defined here rather than in `alepha/testing/vitest`'s setup file
   * because this is the only spec that needs it so far; the second one that
   * does should move it there, the way that file asks.
   */
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
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
    // Work registers the reference and agent prompt kinds (#E75, #Q2624).
    alepha.inject(WorkShell);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    // The atom validates against `projectResourceSchema`, so this is the
    // whole required shape, not a convenient subset.
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    return alepha;
  };

  it("tells the list once the quest sheet is dismissed without a quest", async ({
    expect,
  }) => {
    const alepha = await mount();
    const changes: number[] = [];

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectFeedbackDetail
            feedback={pendingFeedback}
            onChanged={() => changes.push(1)}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    // The header reads `#P1 - Title`, as a quest's and an epic's do
    // (#Q3574), with the whole line in the tooltip.
    const heading = await view.findByTestId("feedback-detail-title");
    expect(heading.textContent).toBe("#P1 - The button does nothing");
    expect(heading.getAttribute("title")).toBe("#P1 - The button does nothing");

    const accept = await view.findByTestId("feedback-accept-button");
    accept.click();

    // The triage is committed the moment Accept is pressed...
    await waitFor(() =>
      expect(alepha.inject(FakeLinkProvider).accepted).toEqual([42]),
    );
    // ...and the list is deliberately NOT told yet: a refetch here moves
    // the selection and takes the open sheet with it.
    expect(changes).toEqual([]);

    // Dismiss the sheet with Escape - the path a user takes when they
    // accepted the report but do not want a quest out of it.
    view.baseElement.ownerDocument.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    await waitFor(() => expect(changes).toEqual([1]));
  });
});

/**
 * A triage inbox whose attachments are almost always screenshots showed none
 * of them: every attachment rendered as a paperclip, a filename and a size,
 * so finding out what was reported meant opening a tab (feedback #2091), and
 * after it a click (feedback #2405). Since #Q4008 they are the discussion's
 * tiles: an image is its own thumbnail, any other file a tile with its name.
 */
describe("ProjectFeedbackDetail - attachment previews", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  const show = async (feedback: FeedbackResource) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    // Work registers the reference and agent prompt kinds (#E75, #Q2624).
    alepha.inject(WorkShell);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture() as never);

    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectFeedbackDetail feedback={feedback} onChanged={() => {}} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("shows an image attachment as a preview, without a click", async ({
    expect,
  }) => {
    const view = await show(withAttachments);

    const thumbnail = await view.findByAltText("screenshot.png");
    expect(thumbnail.tagName).toBe("IMG");
    expect(thumbnail.getAttribute("src")).toContain(
      "00000000-0000-4000-8000-00000000000a",
    );
    // The log is a tile with its name, never an image.
    expect(view.queryByAltText("server.log")).toBeNull();
    expect(view.getByText("server.log")).toBeTruthy();
  });

  it("opens an image in the lightbox on a plain click", async ({ expect }) => {
    const view = await show(withAttachments);

    fireEvent.click(await view.findByAltText("screenshot.png"));
    const dialog = await view.findByRole("dialog");
    expect(dialog.textContent).toContain("screenshot.png");
  });

  it("leaves a non-image attachment as a downloadable tile", async ({
    expect,
  }) => {
    // ⚠️ A FRESH render, not a second click in the case above: the lightbox
    // is already open there, so a dialog count would read 1 whichever tile
    // had opened it and the assertion would pass on a broken classifier.
    const view = await show(withAttachments);

    fireEvent.click(await view.findByText("server.log"));

    expect(view.baseElement.querySelectorAll('[role="dialog"]').length).toBe(0);
  });

  it("keeps every tile a real link to the full file", async ({ expect }) => {
    const view = await show(withAttachments);

    // ⚠️ Only the PLAIN click is taken. The anchor stays real so ⌘-click,
    // middle-click and Open in new tab keep working.
    for (const [name, id] of [
      ["screenshot.png", "00000000-0000-4000-8000-00000000000a"],
      ["server.log", "00000000-0000-4000-8000-00000000000b"],
    ] as const) {
      const anchor = view.container.querySelector(`a[title="${name}"]`);
      expect(anchor?.getAttribute("href")).toBe(`/api/files/${id}`);
      expect(anchor?.getAttribute("target")).toBe("_blank");
    }
  });

  it("lists the tags as plain text in Context, the reserved one left out", async ({
    expect,
  }) => {
    const view = await show({ ...pendingFeedback, tags: ["feedback", "bug"] });

    const tags = view.getByTestId("feedback-tags");
    expect(tags.textContent).toBe("bug");
    // A row of the Context list, not a chip above the description.
    expect(tags.tagName).toBe("DD");
    expect(tags.querySelector("[data-slot=badge]")).toBeNull();
  });
});

/**
 * The linked quest's status chip was a hand-built span in dark-theme shades
 * (`text-emerald-300` on an emerald tint), unreadable on light and with no
 * glyph (#Q4195). It is the shared tint Badge now, as the feedback status.
 */
class QuestRoutes {
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
}

describe("ProjectFeedbackDetail - linked quest status", () => {
  it("draws the linked quest's status as the tint Badge with its icon, in the theme's text colour", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(QuestRoutes);
    alepha.inject(WorkShell);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture() as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectFeedbackDetail
            feedback={
              {
                ...pendingFeedback,
                status: "accepted",
                linkedQuests: [
                  {
                    id: 7,
                    shortId: 12,
                    title: "Fix the button",
                    priority: "medium",
                    status: "completed",
                  },
                ],
              } as FeedbackResource
            }
            onChanged={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const chip = await view.findByTestId("linked-quest-status-7");
    expect(chip.className).toContain("text-foreground");
    expect(chip.className).toContain("bg-success/15");
    expect(chip.className).not.toMatch(/-300\b/);
    expect(chip.querySelector("svg")).not.toBeNull();
  });
});

/**
 * Trust (#Q4216): an untrusted, pending item offers it to a member who can
 * triage; once trusted, the marker stays and says who trusted it.
 */
describe("ProjectFeedbackDetail - Trust", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  const show = async (feedback: FeedbackResource, onChanged = () => {}) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectFeedbackDetail feedback={feedback} onChanged={onChanged} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { alepha, view };
  };

  it("offers Trust on an untrusted pending item, and tells the list once trusted", async ({
    expect,
  }) => {
    const changes: number[] = [];
    const { alepha, view } = await show(
      { ...pendingFeedback, untrusted: true },
      () => changes.push(1),
    );
    fireEvent.click(await view.findByTestId("feedback-trust"));
    await waitFor(() =>
      expect(alepha.inject(FakeLinkProvider).trusted).toEqual([42]),
    );
    await waitFor(() => expect(changes).toEqual([1]));
  });

  it("offers no Trust on a team-written item", async ({ expect }) => {
    const { view } = await show(pendingFeedback);
    await view.findByTestId("feedback-detail-title");
    expect(view.queryByTestId("feedback-trust")).toBeNull();
    expect(view.queryByTestId("feedback-untrusted")).toBeNull();
  });

  it("keeps the marker on a trusted item, says who trusted it, and offers no Trust", async ({
    expect,
  }) => {
    const { view } = await show({
      ...pendingFeedback,
      untrusted: true,
      trustedAt: "2026-11-23T20:00:00.000Z",
      truster: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Ada Lovelace",
      },
    } as FeedbackResource);
    const marker = await view.findByTestId("feedback-untrusted");
    expect(marker.getAttribute("title")).toBe("Trusted by Ada Lovelace");
    expect(view.queryByTestId("feedback-trust")).toBeNull();
  });
});
