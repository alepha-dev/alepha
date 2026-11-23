import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { UseCaseRunResource } from "../../../../api/schemas/useCaseRunResourceSchema.ts";
import UseCaseRuns from "./UseCaseRuns.tsx";

const RUN = {
  id: 41,
  projectId: 1,
  useCaseId: 1,
  createdAt: "2026-11-20T10:00:00.000Z",
  ranAt: "2026-11-20T10:00:00.000Z",
  by: "agent",
  client: "claude-code",
  env: "local",
  scenarioVersion: 3,
  note: "The receipt took a minute to arrive.",
  results: [
    { criterionKey: "C1", result: "passed" },
    {
      criterionKey: "C2",
      result: "failed",
      note: "No mail after `POST /orders` returned **201**",
    },
  ],
  evidence: [
    {
      fileId: "11111111-1111-4111-8111-111111111111",
      name: "order.png",
      mimeType: "image/png",
      size: 10,
      criterionKey: "C1",
    },
    {
      fileId: "22222222-2222-4222-8222-222222222222",
      name: "inbox.png",
      mimeType: "image/png",
      size: 10,
      criterionKey: "C2",
    },
    {
      fileId: "33333333-3333-4333-8333-333333333333",
      name: "session.webm",
      mimeType: "video/webm",
      size: 10,
    },
    {
      fileId: "44444444-4444-4444-8444-444444444444",
      name: "trace.txt",
      mimeType: "text/plain",
      size: 2048,
    },
    {
      fileId: "55555555-5555-4555-8555-555555555555",
      name: "old.png",
      mimeType: "image/png",
      size: 10,
      removedAt: "2026-11-21T10:00:00.000Z",
    },
  ],
} as unknown as UseCaseRunResource;

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({ getUseCaseRuns: async () => [RUN] });
  }
}

/**
 * The Runs tab of a use case (#E153).
 */
describe("UseCaseRuns", () => {
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
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <UseCaseRuns
          projectId={1}
          number={1}
          criteria={
            [
              { key: "C1", text: "An order exists" },
              {
                key: "C2",
                givenText: "a paid order",
                whenText: "the mail leaves",
                thenText: "a receipt arrives",
              },
            ] as never
          }
        />
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("use-case-runs");
  };

  it("lists each file under the criterion it shows, and the others after (#Q3977)", async ({
    expect,
  }) => {
    await mount();
    const c1 = document.querySelector('[data-criterion="C1"]')!;
    const c2 = document.querySelector('[data-criterion="C2"]')!;
    const tile = (name: string) =>
      document.querySelector(`a[title="${name}"]`) as HTMLAnchorElement;
    expect(c1.contains(tile("order.png"))).toBe(true);
    expect(c1.contains(tile("inbox.png"))).toBe(false);
    expect(c2.contains(tile("inbox.png"))).toBe(true);
    const loose = tile("session.webm");
    expect(c1.contains(loose) || c2.contains(loose)).toBe(false);
  });

  it("opens a file in a tab, never through the router that answered 404 (#Q4208)", async ({
    expect,
  }) => {
    await mount();
    const link = document.querySelector(
      'a[title="trace.txt"]',
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/api/files/44444444-4444-4444-8444-444444444444",
    );
    // A `target` is what makes the router leave the click to the browser.
    expect(link.getAttribute("target")).toBe("_blank");
    // Not an image: a tile with its name, no thumbnail.
    expect(link.querySelector("img")).toBeNull();
    expect(link.textContent).toContain("trace.txt");
  });

  it("previews an image evidence and opens it larger on a click (#Q4208)", async ({
    expect,
  }) => {
    await mount();
    const thumbnail = await screen.findByAltText("order.png");
    expect(thumbnail.tagName).toBe("IMG");
    fireEvent.click(thumbnail);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("order.png");
  });

  it("keeps a removed file's name, as text and not a link", async ({
    expect,
  }) => {
    await mount();
    expect(document.querySelector('a[title="old.png"]')).toBeNull();
    expect(screen.getByText(/old\.png/).textContent).toContain("old.png");
  });

  it("reads as a header with the score and verdict, one row per criterion with its title and Markdown evidence, then the observation (#Q3975)", async ({
    expect,
  }) => {
    await mount();
    expect(screen.getByTestId("run-score").getAttribute("aria-label")).toBe(
      "1 of 2 criteria passed",
    );
    expect(screen.getByTestId("run-verdict").textContent).toBe("1 failed: C2");
    const card = screen.getByTestId("use-case-run");
    expect(card.textContent).toContain("v3");
    expect(card.textContent).toContain("claude-code");
    expect(card.textContent).toContain("local");
    const c1 = document.querySelector('[data-criterion="C1"]')!;
    const c2 = document.querySelector('[data-criterion="C2"]')!;
    expect(c1.textContent).toContain("An order exists");
    expect(c2.textContent).toContain(
      "a paid order · the mail leaves · a receipt arrives",
    );
    // The evidence is Markdown: a code span and bold stand out.
    expect(c2.querySelector("code")?.textContent).toBe("POST /orders");
    expect(c2.querySelector("strong")?.textContent).toBe("201");
    expect(screen.getByTestId("run-observation").textContent).toContain(
      "The receipt took a minute to arrive.",
    );
  });
});
