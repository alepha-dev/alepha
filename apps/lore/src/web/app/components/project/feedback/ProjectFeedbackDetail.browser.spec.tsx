import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { beforeAll, describe, it } from "vitest";

import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
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
 * so finding out what was reported meant opening a tab (feedback #2091).
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

  /**
   * ⚠️ The hover preview is GONE, replaced rather than joined (feedback
   * #P2139). Its own spec said these attachments "are almost always
   * screenshots", and a 320px popup that appears while the pointer is on its
   * way to a click is the wrong affordance for the one thing the owner does
   * with them: check it is the right screenshot. The trade is real and was
   * taken deliberately - a hover cost nothing, and a click costs one.
   */
  it("opens an image in the lightbox on a plain click, and leaves other kinds alone", async ({
    expect,
  }) => {
    const view = await show(withAttachments);

    fireEvent.click(await view.findByText("screenshot.png"));
    const dialog = await view.findByRole("dialog");
    expect(dialog.textContent).toContain("screenshot.png");
    expect(
      dialog.querySelector(
        'img[src="/api/files/00000000-0000-4000-8000-00000000000a"]',
      ),
    ).not.toBeNull();
  });

  it("leaves a non-image attachment as a plain link", async ({ expect }) => {
    // ⚠️ A FRESH render, not a second click in the case above: the lightbox
    // is already open there, so a dialog count would read 1 whichever row
    // had opened it and the assertion would pass on a broken classifier.
    const view = await show(withAttachments);

    fireEvent.click(await view.findByText("server.log"));

    expect(view.baseElement.querySelectorAll('[role="dialog"]').length).toBe(0);
  });

  it("keeps every row a real link to the full file", async ({ expect }) => {
    const view = await show(withAttachments);

    // ⚠️ Only the PLAIN click is taken. The anchor stays real so ⌘-click,
    // middle-click and Open in new tab keep working, and so does the row
    // with no JavaScript at all.
    for (const [name, id] of [
      ["screenshot.png", "00000000-0000-4000-8000-00000000000a"],
      ["server.log", "00000000-0000-4000-8000-00000000000b"],
    ] as const) {
      const anchor = (await view.findByText(name)).closest("a");
      expect(anchor?.getAttribute("href")).toBe(`/api/files/${id}`);
      expect(anchor?.getAttribute("target")).toBe("_blank");
    }
  });

  it("fetches no image until the lightbox opens", async ({ expect }) => {
    const view = await show(withAttachments);

    await view.findByText("screenshot.png");
    // The dialog is portalled and mounts on open, so an inbox row with five
    // screenshots still costs no requests to draw - the one property worth
    // keeping from the hover card it replaced.
    expect(view.baseElement.querySelectorAll("img").length).toBe(0);
  });
});

/**
 * The third Agent Prompts surface. Not a table row action here: the panel
 * has no row menu, so this is `AgentPromptsMenu` behind a button in the
 * footer.
 *
 * ⚠️ This is the surface where "build the subject field by field" earns its
 * keep. A feedback resource carries the reporter's identity, the `context`
 * they reported from and their attachments, and the only thing keeping any
 * of it off a clipboard is that seven named fields are copied rather than a
 * resource spread.
 */
describe("ProjectFeedbackDetail - the Agent Prompts menu", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  class Routes {
    feedback = $page({
      name: "projectFeedback",
      path: "/feedback",
      component: () => null,
    });
  }

  const mount = async (
    feedback: FeedbackResource,
    project: unknown = projectFixture(),
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, project as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectFeedbackDetail feedback={feedback} onChanged={() => {}} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { alepha, view };
  };

  const acceptedFeedback: FeedbackResource = {
    ...pendingFeedback,
    status: "accepted",
  };

  const stubClipboard = () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    return written;
  };

  // `screen`, not the render result: the menu's content is portalled onto
  // `document.body`, outside the container `view` queries.
  const trigger = () =>
    screen.queryByRole("button", { name: /agent prompts/i });

  it("is offered on a pending report, last in the row", async ({ expect }) => {
    await mount(pendingFeedback);
    await waitFor(() => expect(trigger()).not.toBeNull());

    /*
     * ⚠️ The row runs the other way now (feedback #P2150): ordered by
     * importance left to right, with the weight falling off as it goes.
     * The primary used to be last, which put it under the floating
     * feedback bubble in the corner and clipped it.
     */
    const footer = trigger()!.closest("div")!;
    const labels = [...footer.querySelectorAll("button")].map(
      (it) => it.textContent ?? "",
    );
    expect(labels[0]).toContain("Promote to Quest");
    expect(labels[1]).toContain("Reject");
    expect(labels[2]).toContain("Delete");

    // Last, and icon-only - so its accessible name comes from `aria-label`
    // and its text content is empty.
    expect(labels[3]).toBe("");
    expect(trigger()).toBe(footer.querySelectorAll("button")[3]);
    // ⚠️ `title` as well, per #Q2017: an `aria-label` alone leaves a
    // pointer user with an unlabelled glyph.
    expect(trigger()!.getAttribute("title")).toBe("Agent Prompts");
  });

  it("is offered on an accepted report", async ({ expect }) => {
    await mount(acceptedFeedback);
    await waitFor(() => expect(trigger()).not.toBeNull());
  });

  /**
   * ⚠️ **Present on `rejected`, carrying the loop alone** (feedback #P2176).
   * This footer had no menu at all until the loop moved into it, and the
   * distinction is the whole reason the entry list is computed once rather
   * than per footer: `feedbackWork` opens by accepting the item, which a
   * rejected report has already been decided against, while `feedbackLoop`
   * is about the INBOX and has nothing to do with the report you happen to
   * be looking at. Hiding the control here would make it appear and
   * disappear on something unrelated to what it does.
   */
  it("offers the loop but not Work on it, on a rejected report", async ({
    expect,
  }) => {
    await mount({
      ...pendingFeedback,
      status: "rejected",
    } as FeedbackResource);
    await waitFor(() => expect(trigger()).not.toBeNull());

    fireEvent.click(trigger()!);
    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')];
      if (found.length === 0) throw new Error("not open yet");
      return found;
    });
    const labels = items.map((it) => it.textContent ?? "").join(" ");
    expect(labels).toContain("Triage the inbox");
    expect(labels).not.toContain("Work on it");
  });

  /**
   * ⚠️ `projectFixture()` turns every declared option ON, so the presence
   * cases above need no argument and these two are the ones that say so.
   */
  it("is absent when agent prompts are off", async ({ expect }) => {
    await mount(
      pendingFeedback,
      projectFixture({ options: { work: { agentPrompts: false } } }),
    );
    await waitFor(() => expect(screen.queryByText("Delete")).not.toBeNull());
    expect(trigger()).toBeNull();
  });

  /**
   * The prompt ends in `quest_create`, which needs Work, and the panel
   * itself exists only under Support. A capability reads another's state to
   * narrow what it offers, never to widen it.
   */
  it("is absent when Support is off", async ({ expect }) => {
    await mount(
      pendingFeedback,
      projectFixture({ capabilities: ["work", "knowledge", "apps"] }),
    );
    await waitFor(() => expect(screen.queryByText("Delete")).not.toBeNull());
    expect(trigger()).toBeNull();
  });

  it("copies a prompt referencing #P, never #F", async ({ expect }) => {
    const written = stubClipboard();
    await mount(pendingFeedback);
    await waitFor(() => expect(trigger()).not.toBeNull());

    fireEvent.click(trigger()!);
    const item = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (it) => it.textContent?.includes("Work on it"),
      );
      if (!found) throw new Error("not open yet");
      return found;
    });
    fireEvent.click(item);

    await waitFor(() => expect(written).toHaveLength(1));
    // ⚠️ `P` is feedback's letter; `F` is the folio's. A prompt saying
    // #F1 sends the agent to a folio.
    expect(written[0]).toContain("#P1");
    expect(written[0]).not.toContain("#F1");
    // The item itself, by its number, since #Q2077 taught the inbox to
    // honour `?feedback=`. It said "The inbox:" before, because the
    // selection was React state and no URL opened one report.
    expect(written[0]).toContain("The report:");
    expect(written[0]).toContain("/feedback?feedback=1");
  });

  /**
   * The end-to-end half of the no-secrets rule: the reporter's identity,
   * the page and user agent in `context`, and the attachments are all on
   * the resource, and none of them may reach a clipboard.
   *
   * ⚠️ Two independent things keep them off, and this case only proves the
   * outer one. `renderPromptTemplate` substitutes seven known names, so an
   * extra field on the subject never reaches the text and this case passes
   * even with the whole resource spread into the subject. The inner
   * guarantee, that the subject itself carries seven fields, is asserted in
   * `useAgentPromptSubject.browser.spec.tsx`, where deleting it goes red.
   */
  it("carries no reporter data, no context and no attachments", async ({
    expect,
  }) => {
    const written = stubClipboard();
    await mount({
      ...pendingFeedback,
      description: "Clicking Save is a no-op.",
      context: {
        path: "/secret-admin-page",
        userAgent: "Mozilla/5.0 (reporter's machine)",
      },
      reporter: {
        id: "00000000-0000-4000-8000-00000000000c",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      attachmentUrls: [
        {
          id: "00000000-0000-4000-8000-00000000000a",
          name: "screenshot.png",
          url: "/api/files/00000000-0000-4000-8000-00000000000a",
          mimeType: "image/png",
          size: 20480,
        },
      ],
    } as unknown as FeedbackResource);
    await waitFor(() => expect(trigger()).not.toBeNull());

    fireEvent.click(trigger()!);
    const item = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (it) => it.textContent?.includes("Work on it"),
      );
      if (!found) throw new Error("not open yet");
      return found;
    });
    fireEvent.click(item);

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).not.toContain("ada@example.com");
    expect(written[0]).not.toContain("Ada Lovelace");
    expect(written[0]).not.toContain("/secret-admin-page");
    expect(written[0]).not.toContain("Mozilla/5.0");
    expect(written[0]).not.toContain("screenshot.png");
    // And the title, which is the one field it is allowed to carry.
    expect(written[0]).toContain("The button does nothing");
  });
});
