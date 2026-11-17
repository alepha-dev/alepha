import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { ProjectUserChip } from "./ProjectUserChip.tsx";

const ADA = {
  id: "00000000-0000-4000-8000-000000000001",
  firstName: "Ada",
  lastName: "Lovelace",
  username: "ada",
  rank: "Admin",
};

/**
 * A person in a list (#Q3829): the avatar, and a card on hover or focus with
 * the name, the username and the rank.
 */
describe("ProjectUserChip", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (ui: ReactNode) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReact);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("is a focusable avatar whose name says the whole card", async ({
    expect,
  }) => {
    await show(<ProjectUserChip user={ADA} />);

    const chip = screen.getByRole("button", {
      name: "Ada Lovelace, @ada, Admin",
    });
    expect(chip.tagName).toBe("BUTTON");
    // The initials, since there is no picture.
    expect(chip.textContent).toContain("AL");
  });

  it("opens the card from the keyboard, with name, username and rank", async ({
    expect,
  }) => {
    await show(<ProjectUserChip user={ADA} detail="Assigned 2 days ago" />);

    fireEvent.focus(screen.getByTestId("project-user-chip"));
    const card = await screen.findByTestId("project-user-card", undefined, {
      timeout: 2000,
    });
    expect(card.textContent).toContain("Ada Lovelace");
    expect(card.textContent).toContain("@ada");
    expect(card.textContent).toContain("Admin");
    expect(card.textContent).toContain("Assigned 2 days ago");
  });

  it("draws the fallback as text when there is nobody to show", async ({
    expect,
  }) => {
    await show(<ProjectUserChip fallback="System" />);

    expect(screen.queryByTestId("project-user-chip")).toBeNull();
    expect(screen.getByText("System")).toBeTruthy();
  });
});
