import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupJsdomMocks } from "alepha/testing/react";
import { beforeAll, describe, it } from "vitest";

import AdminHostLoans from "./AdminHostLoans.tsx";

describe("AdminHostLoans", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  const loans = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      title: `Project ${index + 1}`,
    }));

  it("names three projects, then +N more, whose card lists them all (#Q4049)", async ({
    expect,
  }) => {
    render(<AdminHostLoans loans={loans(50)} />);

    const line = screen.getByTestId("host-loans");
    expect(line.className).toContain("whitespace-nowrap");
    expect(line.textContent).toContain("Project 1, Project 2, Project 3");
    expect(line.textContent).not.toContain("Project 4");

    const more = screen.getByTestId("host-loans-more");
    expect(more.textContent).toBe("+47 more");

    fireEvent.focus(more);
    fireEvent.mouseEnter(more);
    fireEvent.pointerEnter(more);
    const card = await waitFor(() => screen.getByTestId("host-loans-card"));
    expect(card.querySelectorAll("li")).toHaveLength(50);
  });

  it("names up to three projects with no more trigger", ({ expect }) => {
    render(<AdminHostLoans loans={loans(3)} />);

    expect(screen.queryByTestId("host-loans-more")).toBeNull();
  });

  it("says none for a host lent nowhere", ({ expect }) => {
    render(<AdminHostLoans loans={[]} />);

    expect(screen.getByText("none")).toBeTruthy();
  });
});
