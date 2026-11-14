import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { ElementReferenceRegistry } from "../../../registries/ElementReferenceRegistry.ts";
import { I18n } from "../../../services/I18n.ts";
import LoreViewer from "./LoreViewer.tsx";

/**
 * Click an image in a rendered body to see it full size (#Q3604), through
 * the attachments' lightbox: Escape closes it, and an image inside a link
 * keeps the link.
 */
describe("LoreViewer images", () => {
  const mount = async (content: string) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    // What `LoreViewer` reads, injected before the container locks.
    alepha.inject(ElementReferenceRegistry);
    alepha.inject(I18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <LoreViewer
          element={{ kind: "quest", id: 1 } as never}
          content={content}
        />
      </AlephaContext.Provider>,
    );
  };

  it("opens an image full size on click, and Escape closes it", async ({
    expect,
  }) => {
    const view = await mount(
      "Before\n\n![First shot](/api/files/one)\n\n![Second shot](/api/files/two)",
    );
    const images = view.container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(images[1]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Second shot");
    expect(
      dialog
        .querySelector("img")
        ?.getAttribute("src")
        ?.endsWith("/api/files/two"),
    ).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves an image inside a link to its link", async ({ expect }) => {
    const view = await mount("[![Logo](/api/files/logo)](https://example.app)");
    fireEvent.click(view.container.querySelector("img")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
