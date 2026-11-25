import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import {
  ElementReferenceRegistry,
  type ElementReferenceSet,
  type WikiLinkPreviewProps,
} from "../../../registries/ElementReferenceRegistry.ts";
import { I18n } from "../../../services/I18n.ts";
import LoreViewer from "./LoreViewer.tsx";
import WikiLinkHoverProvider from "./WikiLinkHoverProvider.tsx";

const NONE: ElementReferenceSet = { refs: [] };

/**
 * A quest kind whose card says which quest it previews.
 */
const QuestCard = (props: WikiLinkPreviewProps) => (
  <span data-testid="fake-preview">{`Quest ${props.id}`}</span>
);

/**
 * A reference's hover card wherever a body is read (#Q4349): `LoreViewer`
 * brings it, so chat, descriptions and comments have it like a folio does.
 * It opens on hover or keyboard focus, names the item's kind, one card even
 * inside another provider, and a tap on a touch screen opens none.
 */
describe("LoreViewer reference hover card", () => {
  const mount = async (wrap?: (node: ReactNode) => ReactNode) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(ElementReferenceRegistry).register({
      kind: "quest",
      order: 20,
      brokenKey: "folios.wikilink.broken.questNotFound",
      href: (slug, ref) => `/${slug}/quests/${ref.number}`,
      match: (path, slug) =>
        new RegExp(`^/${slug}/quests/(\\d+)$`).exec(path)?.[1],
      preview: QuestCard,
      useReferences: () => NONE,
    });
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const viewer = (
      <LoreViewer
        element={{ kind: "quest", id: 1, projectId: 1, projectSlug: "acme" }}
        content="See [Fix the cart](/acme/quests/12) first."
      />
    );
    return render(
      <AlephaContext.Provider value={alepha}>
        {wrap ? wrap(viewer) : viewer}
      </AlephaContext.Provider>,
    );
  };
  const link = () => screen.getByRole("link", { name: "Fix the cart" });

  it("opens on keyboard focus, naming the item's kind above its card", async ({
    expect,
  }) => {
    await mount();
    act(() => link().focus());
    const preview = await screen.findByTestId("fake-preview");
    expect(preview.textContent).toBe("Quest 12");
    expect(screen.getByTestId("wiki-link-kind").textContent).toBe("Quest");
  });

  it("opens one card inside another provider, the innermost's", async ({
    expect,
  }) => {
    await mount((node) => (
      <WikiLinkHoverProvider projectId={1} projectSlug="acme" attachments={[]}>
        {node}
      </WikiLinkHoverProvider>
    ));
    fireEvent.mouseOver(link());
    await screen.findByTestId("fake-preview");
    expect(screen.getAllByTestId("fake-preview")).toHaveLength(1);
  });

  it("opens nothing for a tap, which follows the link", async ({ expect }) => {
    await mount();
    // The mouseover a tap emulates is what opens the card from a pointer
    // (the case above): after a touch, it is ignored.
    fireEvent.touchStart(link());
    fireEvent.mouseOver(link());
    // Past the open delay, nothing came.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByTestId("fake-preview")).toBeNull();
  });
});
