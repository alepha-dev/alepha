import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { beforeAll, describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import ProjectFeedbackDetail from "./ProjectFeedbackDetail.tsx";

/**
 * Stands in for the HTTP-backed `useClient()` calls this pane and its
 * thread make. Same substitution seam as
 * `QuestDependencyPicker.browser.spec.tsx` (`CLAUDE.md`: never
 * `vi.mock` / `vi.spyOn`).
 */
class FakeLinkProvider extends LinkProvider {
  accepted: number[] = [];

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
      } as Record<string, unknown>,
      {
        get: (target, prop: string) =>
          target[prop] ??
          // An empty array carrying `content` / `items` so it satisfies
          // callers that map the response and callers that unwrap a page,
          // without this fake having to know which is which.
          (async () => Object.assign([], { content: [], items: [] })),
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
  attachments: [],
  tags: [],
};

/**
 * Regression guard for the stale pending row: accepting from this pane
 * commits the triage immediately and then opens the create-a-quest sheet.
 * Only the sheet's SUBMIT path used to notify the list, so dismissing the
 * sheet instead left the row reading `pending` against a feedback the
 * server had already accepted — and pressing Accept again answered
 * "already triaged".
 */
describe("ProjectFeedbackDetail — accept then dismiss", () => {
  /**
   * jsdom implements no `ResizeObserver`, and the create-a-quest sheet
   * mounts `@alepha/ui`'s segmented control, which measures itself with
   * one. Defined here rather than in `vitest.jsdom.ts` because this is the
   * only spec that needs it so far; the second one that does should move it
   * there, the way that file asks.
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
      // Before the modules that reach for it — `AlephaReactRouter`
      // instantiates `LinkProvider`, and a substitution after that is too
      // late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    await alepha.start();
    // The atom validates against `projectResourceSchema`, so this is the
    // whole required shape, not a convenient subset.
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Lore",
      slug: "lore",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);
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

    const accept = await view.findByTestId("feedback-accept-button");
    accept.click();

    // The triage is committed the moment Accept is pressed...
    await waitFor(() =>
      expect(alepha.inject(FakeLinkProvider).accepted).toEqual([42]),
    );
    // ...and the list is deliberately NOT told yet: a refetch here moves
    // the selection and takes the open sheet with it.
    expect(changes).toEqual([]);

    // Dismiss the sheet with Escape — the path a user takes when they
    // accepted the report but do not want a quest out of it.
    view.baseElement.ownerDocument.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    await waitFor(() => expect(changes).toEqual([1]));
  });
});
