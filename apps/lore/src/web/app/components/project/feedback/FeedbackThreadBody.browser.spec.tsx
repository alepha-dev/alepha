import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";

import FeedbackThreadBody from "./FeedbackThreadBody.tsx";

/**
 * A feedback thread renders **no markdown**, deliberately: a reporter is an
 * outsider and the body is shown to the project owner, the same reason a
 * blight's fields are never rendered as markdown.
 *
 * These cases pin both halves of that. A resolved mention becomes a link,
 * and everything else - markup included - stays text.
 */
class Routes {
  members = $page({
    name: "projectSettingsMembers",
    path: "/:projectSlug/settings/members",
    component: () => null,
  });
}

const MEMBERS = [{ name: "nfo" }, { name: "fabrice" }];

const mount = async (body: string, members = MEMBERS) => {
  const alepha = Alepha.create()
    .with(AlephaLogger)
    .with(AlephaReact)
    .with(AlephaReactI18n)
    .with(AlephaReactRouter);
  alepha.inject(Routes);
  await alepha.start();

  return render(
    <AlephaContext.Provider value={alepha}>
      <FeedbackThreadBody body={body} members={members} projectSlug="alepha" />
    </AlephaContext.Provider>,
  );
};

describe("FeedbackThreadBody", () => {
  it("links a handle that resolves to a member", async () => {
    const view = await mount("hey @nfo can you look");

    const link = view.container.querySelector("a");
    expect(link?.textContent).toBe("@nfo");
    expect(link?.getAttribute("href")).toBe("/alepha/settings/members");
    expect(view.container.textContent).toBe("hey @nfo can you look");
  });

  it("leaves a handle nobody owns as text", async () => {
    const view = await mount("cc @nobody on this");

    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toBe("cc @nobody on this");
  });

  /**
   * ⚠️ The whole posture. Markup in an outsider's comment must reach the
   * owner as characters, never as elements.
   */
  it("renders markup as text, not as elements", async () => {
    const view = await mount(
      "<img src=x onerror=alert(1)> and **bold** and [a](b)",
    );

    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("strong")).toBeNull();
    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toBe(
      "<img src=x onerror=alert(1)> and **bold** and [a](b)",
    );
  });

  /**
   * The same four shapes the server holds out, from the same regex, so a
   * handle in a code span neither links nor pings.
   */
  it("holds out a handle inside a code span", async () => {
    const view = await mount("the decorator is `@nfo` in that file");

    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toBe(
      "the decorator is `@nfo` in that file",
    );
  });

  it("does not link an email address", async () => {
    const view = await mount("write to me@nfo.example about it");

    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toBe("write to me@nfo.example about it");
  });

  it("links every resolved handle in one body", async () => {
    const view = await mount("@nfo and @fabrice, both of you");

    const links = [...view.container.querySelectorAll("a")].map(
      (a) => a.textContent,
    );
    expect(links).toEqual(["@nfo", "@fabrice"]);
    expect(view.container.textContent).toBe("@nfo and @fabrice, both of you");
  });

  /**
   * The reporter's own sheet is outside the project shell, so there is no
   * roster to read and nothing should link.
   */
  it("links nothing when there is no roster", async () => {
    const view = await mount("hey @nfo", []);

    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toBe("hey @nfo");
  });
});
