import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import QuestViewRailEpicLink from "./QuestViewRailEpicLink.tsx";

/**
 * The one route the link resolves against. The real `AppRouter` is not
 * mounted: this component takes its `href` ready-made and only needs a router
 * for `Link` to render an anchor at all.
 */
class Routes {
  epic = $page({
    name: "projectEpic",
    path: "/epics/:epicNumber",
    component: () => null,
  });
}

/**
 * The epic row of the quest rail shows the reference and nothing else, and the
 * title it stops drawing has to survive as the accessible name (feedback
 * #P2166, quest #Q2157... see the component's own note).
 *
 * Both halves are asserted on purpose. "Renders `#E43`" alone would pass for a
 * link that had simply dropped the title, which is the regression this pair
 * exists to prevent: a bare reference is an unlabelled link.
 */
describe("QuestViewRailEpicLink", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const LONG_TITLE = "UX/UI - Refonte du poste agent";

  const mount = async (number = 43, title = LONG_TITLE) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    await alepha.start();

    return render(
      <AlephaContext.Provider value={alepha}>
        <QuestViewRailEpicLink number={number} title={title} href="/epics/43" />
      </AlephaContext.Provider>,
    );
  };

  it("draws the reference alone, without the title", async () => {
    await mount();

    const link = await screen.findByRole("link");
    expect(link.textContent).toBe("#E43");
    // The title is the thing that used to fill the rail. It must not be drawn.
    expect(link.textContent).not.toContain("Refonte");
  });

  it("keeps the title as the link's accessible name", async () => {
    await mount();

    // By accessible name, not by text: this is the assertion that a reader
    // still learns which epic the link goes to.
    const link = await screen.findByRole("link", {
      name: `#E43 ${LONG_TITLE}`,
    });
    expect(link).toBeDefined();
  });

  it("shows the title on hover, for a pointer", async () => {
    await mount();

    // `title` rather than a styled tooltip, so the same string serves the
    // pointer and the accessibility tree instead of only the pointer.
    const link = await screen.findByRole("link");
    expect(link.getAttribute("title")).toBe(LONG_TITLE);
  });

  it("builds the reference through formatReference, so the grammar is one implementation", async () => {
    // A different number, to catch a hardcoded string surviving a copy-paste.
    await mount(7, "Epic Workflow");

    const link = await screen.findByRole("link");
    expect(link.textContent).toBe("#E7");
    expect(link.getAttribute("aria-label")).toBe("#E7 Epic Workflow");
  });
});
