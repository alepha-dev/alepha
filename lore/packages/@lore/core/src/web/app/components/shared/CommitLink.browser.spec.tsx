import { cleanup, fireEvent, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import type { ReactNode } from "react";
import { afterEach, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import CommitLink from "./CommitLink.tsx";

/**
 * The one commit link the quest rail and both artifact views share (feedback
 * #P2201, #Q2336): to the commit on the project's forge when the project
 * names a repository Lore can link (#Q4217), plain text otherwise.
 */
describe("CommitLink", () => {
  const sha = "0b35cb375ff0123456789abcdef0123456789abc";
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (node: ReactNode, repositoryUrl?: string) => {
    alepha = Alepha.create().with(AlephaReact);
    await alepha.start();
    alepha.store.set(currentProjectAtom, {
      ...projectFixture({ title: "Acme", slug: "acme" }),
      repositoryUrl,
    });
    return render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
  };

  it("links the short sha to <repositoryUrl>/commit/<full sha> on GitHub, in a new tab", async ({
    expect,
  }) => {
    const ui = await mount(
      <CommitLink sha={sha} />,
      "https://github.com/acme/api",
    );

    const link = ui.getByRole("link");
    expect(link.textContent).toBe("0b35cb3");
    expect(link.getAttribute("href")).toBe(
      `https://github.com/acme/api/commit/${sha}`,
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // No outbound icon on a sha, by decision (#Q2222).
    expect(link.querySelector("svg")).toBeNull();
  });

  it("renders the short sha as plain text without a repository, or on a forge Lore cannot link", async ({
    expect,
  }) => {
    const ui = await mount(<CommitLink sha={sha} />);
    expect(ui.queryByRole("link")).toBeNull();
    expect(ui.container.textContent).toBe("0b35cb3");
    cleanup();
    await alepha?.stop();

    const other = await mount(
      <CommitLink sha={sha} />,
      "https://git.example.app/acme/api",
    );
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
      "https://github.com/acme/api",
    );

    fireEvent.click(ui.getByRole("link"));

    expect(rowClicks).toBe(0);
  });
});
