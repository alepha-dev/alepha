import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import { BROKEN_HREF_PREFIX } from "./folioWikiLinkResolver.ts";
import WikiLinkHoverProvider from "./WikiLinkHoverProvider.tsx";

/**
 * Serves nothing: the link below is a broken reference, the one kind of card
 * that sends no request, so these cases are about the card and not a fetch.
 */
class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
  }
}

/**
 * A rect from `top` to `bottom`, from 40px to `right` on the x axis.
 */
const rectOf = (top: number, bottom: number, right: number): DOMRect =>
  ({
    top,
    bottom,
    left: 40,
    right,
    width: right - 40,
    height: bottom - top,
    x: 40,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * The hover card follows its link while the folio scrolls (#Q2354), and still
 * closes when the pointer leaves the link (#Q1183).
 *
 * jsdom lays nothing out, so every rect here is assigned: the pane is the
 * folio's scroll container, 500px tall from the top of the viewport, and the
 * link's rect is moved between scroll events the way a real scroll moves it.
 */
describe("the wiki-link hover card", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const setup = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <div data-testid="pane" style={{ overflowY: "auto" }}>
          <WikiLinkHoverProvider
            projectId={1}
            projectSlug="acme"
            attachments={[]}
          >
            <p>
              <a
                data-testid="link"
                href={`${BROKEN_HREF_PREFIX}quest-not-found`}
              >
                [[#Q1]]
              </a>
              <span data-testid="prose"> and some prose after it.</span>
            </p>
          </WikiLinkHoverProvider>
        </div>
      </AlephaContext.Provider>,
    );

    const pane = view.getByTestId("pane");
    const link = view.getByTestId("link");
    pane.getBoundingClientRect = () => rectOf(0, 500, 800);
    let linkTop = 200;
    // A link 20px tall and 120px wide.
    link.getBoundingClientRect = () => rectOf(linkTop, linkTop + 20, 160);

    const card = () =>
      document.querySelector<HTMLElement>('[data-slot="wiki-link-hover-card"]');
    const open = async () => {
      fireEvent.mouseOver(link);
      await waitFor(() => {
        if (!card()) throw new Error("the card has not opened");
      });
      // On screen is not yet following its link. The hover delay's timer
      // commits the card outside `act`, and React yields for a paint after
      // that commit, so the passive effect that attaches the scroll listener
      // runs in a later Scheduler task. `waitFor` returns through a
      // `setTimeout(0)`, which a process that lost the CPU for a millisecond
      // runs first: the next scroll then had nobody listening. An awaited
      // `act` waits a macrotask queued behind that task.
      await act(async () => {});
    };
    const scrollTo = (top: number) => {
      linkTop = top;
      act(() => {
        fireEvent.scroll(pane);
      });
    };
    return { view, pane, link, card, open, scrollTo };
  };

  it("opens 8px below its link", async ({ expect }) => {
    const { card, open } = await setup();

    await open();

    expect(card()!.style.top).toBe("228px");
    expect(card()!.style.left).toBe("40px");
  });

  it("moves with its link when the folio scrolls", async ({ expect }) => {
    const { card, open, scrollTo } = await setup();
    await open();

    scrollTo(90);
    expect(card()!.style.top).toBe("118px");

    scrollTo(310);
    expect(card()!.style.top).toBe("338px");
  });

  it("closes once its link scrolls out of the pane", async ({ expect }) => {
    const { card, open, scrollTo } = await setup();
    await open();

    // Still touching the pane's top edge: kept.
    scrollTo(-10);
    expect(card()).not.toBeNull();

    // Wholly above it: gone, rather than pinned to the edge.
    scrollTo(-20);
    expect(card()).toBeNull();
  });

  it("closes once its link scrolls below the pane", async ({ expect }) => {
    const { card, open, scrollTo } = await setup();
    await open();

    scrollTo(500);
    expect(card()).toBeNull();
  });

  it("still closes when the pointer leaves the link", async ({ expect }) => {
    const { view, link, card, open } = await setup();
    await open();

    fireEvent.mouseOut(link, { relatedTarget: view.getByTestId("prose") });

    await waitFor(() => expect(card()).toBeNull());
  });

  it("stays open while the pointer crosses onto the card", async ({
    expect,
  }) => {
    const { link, card, open } = await setup();
    await open();

    fireEvent.mouseOut(link, { relatedTarget: card() });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(card()).not.toBeNull();
  });
});
