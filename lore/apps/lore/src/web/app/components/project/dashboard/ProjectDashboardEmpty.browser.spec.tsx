import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, it } from "vitest";

import { I18n } from "../../../services/I18n.ts";
import ProjectDashboardEmpty from "./ProjectDashboardEmpty.tsx";

/**
 * The board with no cards on it (feedback #P2180).
 *
 * The whole page at zero cards: no header, no Add button up top, one empty
 * state shaped like `AlephaTable`'s - a muted icon, a title, a line, and the
 * action - with the Add card button in it for whoever can use it.
 */
describe("ProjectDashboardEmpty", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: {
    canEdit: boolean;
    hasOfferableMetric: boolean;
  }) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    let added = 0;
    render(
      <AlephaContext.Provider value={alepha}>
        <ProjectDashboardEmpty
          {...props}
          onAdd={() => {
            added++;
          }}
        />
      </AlephaContext.Provider>,
    );
    return { added: () => added };
  };

  it("carries the Add card button for an editor, and it opens the catalogue", async ({
    expect,
  }) => {
    const board = await mount({ canEdit: true, hasOfferableMetric: true });

    const empty = screen.getByTestId("dashboard-empty");
    const add = screen.getByTestId("dashboard-add");
    expect(empty.contains(add)).toBe(true);
    expect(add.textContent).toContain("Add card");

    fireEvent.click(add);
    expect(board.added()).toBe(1);
  });

  it("is an empty state, not a dashed panel", async ({ expect }) => {
    await mount({ canEdit: true, hasOfferableMetric: true });

    const empty = screen.getByTestId("dashboard-empty");
    expect(empty.className).not.toContain("border-dashed");
    // A muted icon over the title, the way `AlephaTable` draws its own.
    expect(empty.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Nothing on this board yet")).toBeTruthy();
  });

  it("keeps the docs link, under the action", async ({ expect }) => {
    await mount({ canEdit: true, hasOfferableMetric: true });

    const docs = screen.getByTestId("dashboard-empty-docs");
    const add = screen.getByTestId("dashboard-add");
    // Secondary to the action, so after it in the document.
    expect(
      add.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers no button to a reader who cannot add a card", async ({
    expect,
  }) => {
    await mount({ canEdit: false, hasOfferableMetric: true });

    expect(screen.queryByTestId("dashboard-add")).toBeNull();
    // It says who can, rather than showing a button that would do nothing.
    expect(screen.getByTestId("dashboard-empty").textContent).toMatch(
      /Someone with permission/,
    );
  });

  it("offers no button when no capability answers a metric", async ({
    expect,
  }) => {
    await mount({ canEdit: true, hasOfferableMetric: false });

    // The catalogue would be empty, so an Add button would open nothing.
    expect(screen.queryByTestId("dashboard-add")).toBeNull();
    expect(screen.getByTestId("dashboard-empty-docs")).toBeTruthy();
  });
});
