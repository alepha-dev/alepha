import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import AttachmentLightbox, {
  type PreviewableAttachment,
} from "./AttachmentLightbox.tsx";
import { attachmentPreview } from "./attachmentPreview.ts";

const ITEMS: PreviewableAttachment[] = [
  { fileId: "a", name: "first.png", mimeType: "image/png" },
  { fileId: "b", name: "second.png", mimeType: "image/png" },
  { fileId: "c", name: "page.html", mimeType: "text/html" },
  { fileId: "d", name: "clip.mp4", mimeType: "video/mp4" },
];

/**
 * The viewer's maximize toggle (#Q3887): the dialog fills the viewport, the
 * image, the HTML frame and the code view follow it, and the choice holds
 * while paging through the carousel.
 */
describe("AttachmentLightbox", () => {
  let alepha: Alepha | undefined;
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    // The Preview / Code switch is a `Segmented`, which measures its thumb.
    setupJsdomMocks();
  });
  afterEach(async () => {
    cleanup();
    globalThis.fetch = realFetch;
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (openId: string | null) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const app = alepha;
    const view = (id: string | null) => (
      <AlephaContext.Provider value={app}>
        <AttachmentLightbox items={ITEMS} openId={id} onOpenChange={() => {}} />
      </AlephaContext.Provider>
    );
    const ui = render(view(openId));
    return { rerender: (id: string | null) => ui.rerender(view(id)) };
  };

  const toggle = () => screen.getByTestId("attachment-maximize");
  const dialog = () =>
    document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
  const image = () => dialog().querySelector("img") as HTMLImageElement;

  it("maximizes to the viewport, and the image loses its 70vh cap", async ({
    expect,
  }) => {
    await show("a");
    await waitFor(() => expect(toggle()).toBeTruthy());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Maximize");
    expect(dialog().hasAttribute("data-maximized")).toBe(false);
    expect(image().className).toContain("max-h-[70vh]");

    fireEvent.click(toggle());

    await waitFor(() =>
      expect(dialog().hasAttribute("data-maximized")).toBe(true),
    );
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Restore size");
    expect(dialog().className).toContain("h-[calc(100dvh-2rem)]");
    expect(image().className).not.toContain("max-h-[70vh]");
    expect(image().className).toContain("h-full");

    fireEvent.click(toggle());
    await waitFor(() =>
      expect(dialog().hasAttribute("data-maximized")).toBe(false),
    );
  });

  it("stays maximized while paging, and the HTML frame fills the dialog", async ({
    expect,
  }) => {
    // The viewer reads a text file's body with a bare `fetch`, which has no
    // provider to substitute: the global is swapped and restored after.
    globalThis.fetch = Object.assign(
      async () =>
        new Response("<p>hello</p>", {
          headers: { "content-type": "text/html" },
        }),
      { preconnect: realFetch.preconnect },
    );
    await show("a");
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("second.png")).toBeTruthy());
    expect(dialog().hasAttribute("data-maximized")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const frame = await screen.findByTestId("attachment-html-preview");
    expect(dialog().hasAttribute("data-maximized")).toBe(true);
    expect(frame.className).toContain("h-full");
    expect(frame.className).not.toContain("h-[70vh]");

    // The Code tab fills it too: the `<pre>` carries the full height.
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    const text = await screen.findByTestId("attachment-text-preview");
    await waitFor(() => expect(text.querySelector("pre")).toBeTruthy());
    expect(text.className).toContain("[&_pre]:h-full");
    expect(text.className).not.toContain("[&_pre]:max-h-[70vh]");
  });

  it("forgets the choice once the viewer closes", async ({ expect }) => {
    const ui = await show("a");
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(dialog().hasAttribute("data-maximized")).toBe(true),
    );

    ui.rerender(null);
    ui.rerender("b");

    await waitFor(() => expect(toggle()).toBeTruthy());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  /**
   * A video plays in the viewer with the browser's own controls, where it
   * used to be a plain file tile with nothing to show.
   */
  it("plays a video with the browser's controls", async ({ expect }) => {
    // Mounted closed and then opened on the video, as a tile click does.
    const ui = await show(null);
    ui.rerender("d");
    const video = await screen.findByTestId("attachment-video");
    expect(video.tagName).toBe("VIDEO");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("src")).toBe("/api/files/d");
  });

  it("knows a video by its name when the browser left its type blank", ({
    expect,
  }) => {
    expect(attachmentPreview("holiday.MOV", "").kind).toBe("video");
    expect(attachmentPreview("clip.webm", "video/webm").kind).toBe("video");
    expect(attachmentPreview("notes.txt", "text/plain").kind).toBe("text");
  });
});
