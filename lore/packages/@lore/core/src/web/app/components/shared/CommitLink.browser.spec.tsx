import { fireEvent, render } from "@testing-library/react";
import { describe, it } from "vitest";

import CommitLink from "./CommitLink.tsx";

/**
 * The one commit link the quest rail and both artifact views share (feedback
 * #P2201, #Q2336).
 */
describe("CommitLink", () => {
  const sha = "0b35cb375ff0123456789abcdef0123456789abc";

  it("links the short sha to <repositoryUrl>/commit/<full sha> in a new tab", ({
    expect,
  }) => {
    const ui = render(
      <CommitLink
        sha={sha}
        repositoryUrl="https://github.com/alepha-dev/alepha"
      />,
    );

    const link = ui.getByRole("link");
    expect(link.textContent).toBe("0b35cb3");
    expect(link.getAttribute("href")).toBe(
      `https://github.com/alepha-dev/alepha/commit/${sha}`,
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // No outbound icon on a sha, by decision (#Q2222).
    expect(link.querySelector("svg")).toBeNull();
  });

  it("renders the short sha as plain text without a repository", ({
    expect,
  }) => {
    const ui = render(<CommitLink sha={sha} repositoryUrl={undefined} />);

    expect(ui.queryByRole("link")).toBeNull();
    expect(ui.container.textContent).toBe("0b35cb3");
  });

  it("stops the click at the link, so the row it sits in does not act", ({
    expect,
  }) => {
    let rowClicks = 0;
    const ui = render(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for a clickable row
      <div onClick={() => rowClicks++}>
        <CommitLink
          sha={sha}
          repositoryUrl="https://github.com/alepha-dev/alepha"
        />
      </div>,
    );

    fireEvent.click(ui.getByRole("link"));

    expect(rowClicks).toBe(0);
  });
});
