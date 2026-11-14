import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import AssistantReplyLink from "@/web/assistant/AssistantReplyLink.tsx";

class Routes {
  quest = $page({
    name: "quest",
    path: "/:projectSlug/quests/:shortId",
    component: () => null,
  });
}

/**
 * A link in an assistant reply (#Q3211): routed in-app only when the router
 * resolves it to a page, opened on the docs site for a guide, text otherwise.
 */
describe("AssistantReplyLink", () => {
  const mount = async (href: string) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AssistantReplyLink href={href}>the link</AssistantReplyLink>
      </AlephaContext.Provider>,
    );
  };

  it("routes a path the router resolves to a page", async ({ expect }) => {
    const view = await mount("/acme/quests/12");
    const link = view.getByTestId("assistant-link");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/acme/quests/12");
  });

  it("leaves a path no page answers as text", async ({ expect }) => {
    const view = await mount("/nowhere");
    expect(view.queryByRole("link")).toBeNull();
    expect(view.getByText("the link").tagName).toBe("SPAN");
  });

  it("leaves an outside URL as text", async ({ expect }) => {
    const view = await mount("https://example.app/phish");
    expect(view.queryByRole("link")).toBeNull();
  });

  it("opens a page of Lore's guides on the docs site, in a new tab", async ({
    expect,
  }) => {
    const view = await mount("https://alepha.dev/lore/docs/plan-quests");
    const link = view.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
