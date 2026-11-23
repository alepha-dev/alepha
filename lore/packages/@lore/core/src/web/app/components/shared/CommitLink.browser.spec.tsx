import { cleanup, fireEvent, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import type { ReactNode } from "react";
import { afterEach, describe, it } from "vitest";

import { CommitLinkRegistry } from "../../registries/CommitLinkRegistry.ts";
import CommitLink from "./CommitLink.tsx";

/**
 * The one commit link the quest rail and both artifact views share (feedback
 * #P2201, #Q2336): into the project's own Lore repository when Build says
 * where (#Q4136), plain text otherwise.
 */
describe("CommitLink", () => {
  const sha = "0b35cb375ff0123456789abcdef0123456789abc";
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (node: ReactNode, linked: boolean) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactRouter);
    if (linked) {
      alepha
        .inject(CommitLinkRegistry)
        .register((commit, repo) =>
          repo === "elsewhere" ? undefined : `/acme/code/api/commit/${commit}`,
        );
    }
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
  };

  it("links the short sha to its commit page in the Lore repository", async ({
    expect,
  }) => {
    const ui = await mount(<CommitLink sha={sha} />, true);

    const link = ui.getByRole("link");
    expect(link.textContent).toBe("0b35cb3");
    expect(link.getAttribute("href")).toBe(`/acme/code/api/commit/${sha}`);
    // In the app: no new tab, no outbound icon (#Q2222).
    expect(link.getAttribute("target")).toBeNull();
    expect(link.querySelector("svg")).toBeNull();
  });

  it("renders the short sha as plain text when nothing links it", async ({
    expect,
  }) => {
    const ui = await mount(<CommitLink sha={sha} />, false);
    expect(ui.queryByRole("link")).toBeNull();
    expect(ui.container.textContent).toBe("0b35cb3");
    cleanup();
    await alepha?.stop();

    const other = await mount(<CommitLink sha={sha} repo="elsewhere" />, true);
    expect(other.queryByRole("link")).toBeNull();
  });

  it("stops the click at the link, so the row it sits in does not act", async ({
    expect,
  }) => {
    let rowClicks = 0;
    const ui = await mount(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for a clickable row
      <div onClick={() => rowClicks++}>
        <CommitLink sha={sha} />
      </div>,
      true,
    );

    fireEvent.click(ui.getByRole("link"));

    expect(rowClicks).toBe(0);
  });
});
