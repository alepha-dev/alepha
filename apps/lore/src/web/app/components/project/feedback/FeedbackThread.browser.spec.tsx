import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FeedbackCommentResource } from "@/api/schemas/feedbackCommentResourceSchema.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import FeedbackThread from "./FeedbackThread.tsx";

const ME = "00000000-0000-4000-8000-000000000001";

const aComment = (): FeedbackCommentResource =>
  ({
    id: 7,
    feedbackId: 1,
    authorId: ME,
    authorName: "Nico",
    body: "Seen on staging too.",
    createdAt: "2026-09-14T10:00:00.000Z",
  }) as unknown as FeedbackCommentResource;

/**
 * A thread holding one comment of the viewer's, whose server refuses both
 * writes.
 */
class FakeLinkProvider extends LinkProvider {
  calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listFeedbackComments: async () => [aComment()],
      createFeedbackComment: async () => {
        this.calls.push("createFeedbackComment");
        throw new Error("This feedback is closed to comments (spec)");
      },
      deleteFeedbackComment: async () => {
        this.calls.push("deleteFeedbackComment");
        throw new Error("Only the author may delete this comment (spec)");
      },
    });
  }
}

/**
 * Posting and deleting a feedback comment are `useAction`s (#E59, #Q2328).
 * Both used to be plain functions with no catch, so a refusal was an
 * unhandled rejection and the comment simply did not appear, or did not go.
 * Now the root listener says why, exactly once, and the page keeps what it
 * had: the draft, or the comment.
 */
describe("FeedbackThread", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <FeedbackThread feedbackId={1} currentUserId={ME} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Seen on staging too.");
    return alepha.inject(FakeLinkProvider);
  };

  const expectOneToast = async (message: string) => {
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
  };

  it("toasts a refused post once, and keeps the draft", async () => {
    const fake = await mount();

    const box = screen.getByPlaceholderText(
      "Ask a question or record a finding.",
    );
    fireEvent.change(box, { target: { value: "Still broken for me." } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await expectOneToast("This feedback is closed to comments (spec)");
    expect(fake.calls).toEqual(["createFeedbackComment"]);
    expect((box as HTMLTextAreaElement).value).toBe("Still broken for me.");
  });

  it("toasts a refused delete once, and keeps the comment", async () => {
    const fake = await mount();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await expectOneToast("Only the author may delete this comment (spec)");
    expect(fake.calls).toEqual(["deleteFeedbackComment"]);
    expect(screen.getByText("Seen on staging too.")).toBeTruthy();
  });
});
