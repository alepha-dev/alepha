import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminUserCell } from "../AdminUserCell.tsx";

/**
 * The cell is the single way admin tables name a user, so what it pins is
 * the identifier precedence (real name > username > email > truncated id)
 * and that the label is always a real link to the user detail page: the
 * fallbacks must never silently drop the navigation.
 */
describe("AdminUserCell", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("prefers the real name and links to the user detail page", async () => {
    await mount(
      <AdminUserCell
        userId="0192aaaa-0000-7000-8000-000000000001"
        user={{
          email: "owner@example.com",
          username: "owner",
          firstName: "Ada",
          lastName: "Lovelace",
        }}
      />,
    );

    expect(screen.queryByText("owner")).toBeNull();
    const link = screen.getByRole("link", { name: "Ada Lovelace" });
    expect(link.getAttribute("href")).toBe(
      "/admin/users/0192aaaa-0000-7000-8000-000000000001",
    );
  });

  it("falls back to the username without a name, then the email", async () => {
    await mount(
      <>
        <AdminUserCell
          userId="0192aaaa-0000-7000-8000-000000000002"
          user={{ email: "owner@example.com", username: "owner" }}
        />
        <AdminUserCell
          userId="0192aaaa-0000-7000-8000-000000000005"
          user={{ email: "other@example.com" }}
        />
      </>,
    );

    expect(screen.getByRole("link", { name: "owner" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "other@example.com" }),
    ).toBeTruthy();
  });

  it("keeps the link with a truncated id when the owner no longer resolves", async () => {
    await mount(
      <AdminUserCell userId="0192aaaa-0000-7000-8000-000000000003" />,
    );

    const link = screen.getByRole("link", { name: "0192aaaa" });
    expect(link.getAttribute("href")).toBe(
      "/admin/users/0192aaaa-0000-7000-8000-000000000003",
    );
  });

  it("renders a dash without a user id", async () => {
    await mount(<AdminUserCell />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("uses the snapshot label before the truncated id, still linked", async () => {
    // The audit-log shape: a write-time email snapshot plus the actor id,
    // no live summary.
    await mount(
      <AdminUserCell
        userId="0192aaaa-0000-7000-8000-000000000004"
        fallbackLabel="snapshot@example.com"
      />,
    );

    expect(
      screen.getByRole("link", { name: "snapshot@example.com" }),
    ).toBeTruthy();
  });

  it("renders the snapshot label unlinked when there is no id", async () => {
    await mount(<AdminUserCell fallbackLabel="snapshot@example.com" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("snapshot@example.com")).toBeTruthy();
  });
});
