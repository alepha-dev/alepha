import { cleanup, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import AdminDashboard from "../AdminDashboard.tsx";

/**
 * The admin dashboard after #Q3667: a muted greeting above tiles declared in
 * code, four to a row on a wide screen, and no Customize.
 */
describe("AdminDashboard", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (user?: Record<string, unknown>) => {
    alepha = Alepha.create()
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    if (user) {
      alepha.store.set(currentUserAtom, { id: "u1", roles: [], ...user });
    }
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminDashboard
          cards={[
            { id: "b", title: "Second", order: 2, render: () => <p>B</p> },
            { id: "a", title: "First", order: 1, render: () => <p>A</p> },
            {
              id: "hidden",
              title: "Hidden",
              can: () => false,
              render: () => <p>H</p>,
            },
          ]}
        />
      </AlephaContext.Provider>,
    );
  };

  it("greets by name, else username, else the email's local part", async () => {
    const hello = async (user: Record<string, unknown>) => {
      const view = await mount(user);
      const text = view.getByTestId("admin-dashboard-hello").textContent;
      cleanup();
      await alepha?.stop();
      return text;
    };
    expect(await hello({ name: "Ada Lovelace", username: "ada" })).toBe(
      "Hello Ada Lovelace",
    );
    expect(await hello({ username: "ada", email: "ada@example.com" })).toBe(
      "Hello ada",
    );
    expect(await hello({ email: "ada.l@example.com" })).toBe("Hello ada.l");
  });

  it("lays its tiles out in code order, four to a row, with no Customize", async () => {
    const view = await mount({ name: "Ada" });
    const regions = view.getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "First",
      "Second",
    ]);
    expect(regions[0]?.parentElement?.className).toContain("lg:grid-cols-4");
    expect(view.queryByRole("button", { name: /customize/i })).toBeNull();
  });
});
