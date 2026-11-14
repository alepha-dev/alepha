import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { expectAccessible, setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { DialogProvider } from "../../core/useDialog.tsx";
import { ActionErrorToaster } from "../../shell/ActionErrorToaster.tsx";
import AdminDashboard from "../AdminDashboard.tsx";
import type { AdminDashboardCard } from "../AdminDashboardCard.tsx";
import type { AdminDashboardLayoutTile } from "../adminDashboardLayout.ts";

/**
 * The layout API, faked at the link layer like every admin page spec.
 */
class Links extends LinkProvider {
  public denied: string[] = [];
  public saves: Array<{ tiles: AdminDashboardLayoutTile[]; version: number }> =
    [];
  public conflict = false;

  override client(): any {
    const actions: Record<string, any> = {
      getAdminDashboardLayout: async () => ({
        layout: { tiles: [] },
        version: 0,
      }),
      setAdminDashboardLayout: async (args: any) => {
        if (this.conflict) {
          throw new HttpError(
            { status: 409 },
            { message: "The dashboard layout was changed by another admin" },
          );
        }
        this.saves.push({
          tiles: args.body.layout.tiles,
          version: args.body.expectedVersion,
        });
        return { layout: args.body.layout, version: 4 };
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => !this.denied.includes(key);
        return action;
      },
    });
  }
}

const tile = (
  id: string,
  extra: Partial<AdminDashboardCard> = {},
): AdminDashboardCard => ({
  id,
  title: `Tile ${id}`,
  description: `What ${id} shows`,
  render: () => <a href={`/admin/${id}`}>Open {id}</a>,
  ...extra,
});

/**
 * Customize mode (#Q3538): show, hide and reorder tiles, save with the
 * version read, a 409 as a notice, reset after a confirm.
 */
describe("AdminDashboard (Customize)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    cards: AdminDashboardCard[],
    setup?: (links: Links) => void,
    layoutVersion: number | null = 3,
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    const links = alepha.inject(Links);
    setup?.(links);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <AdminDashboard
            cards={cards}
            layout={{ tiles: [] }}
            layoutVersion={layoutVersion ?? undefined}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return links;
  };

  const customize = () =>
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

  const gridTitles = () =>
    Array.from(
      document.querySelectorAll("[data-slot=dashboard-edit-cell]"),
    ).map((cell) => cell.querySelector("span")?.textContent);

  it("offers Customize only to an admin who can read and write the layout", async () => {
    await mount([tile("a")], (links) => {
      links.denied = ["setAdminDashboardLayout"];
    });
    expect(screen.queryByRole("button", { name: "Customize" })).toBeNull();
  });

  it("offers no Customize without a layout read by the loader", async () => {
    await mount([tile("a")], undefined, null);
    expect(screen.queryByRole("button", { name: "Customize" })).toBeNull();
  });

  it("makes each tile inert and keeps its link out of the tab order", async () => {
    await mount([tile("a"), tile("b")]);
    customize();

    const link = screen.getByText("Open a").closest("a")!;
    expect(link.closest("[inert]")).not.toBeNull();
    // Tab walks the controls only: no focusable element outside an inert
    // subtree is a tile's link.
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    ).filter((el) => !el.closest("[inert]"));
    expect(focusable.some((el) => el.textContent?.startsWith("Open"))).toBe(
      false,
    );
    expect(screen.getByText("Changes apply to every admin.")).toBeTruthy();
    await expectAccessible();
  });

  it("removes a tile to the picker, with its title and description, and adds it back", async () => {
    await mount([tile("a"), tile("b")]);
    customize();

    fireEvent.click(screen.getByRole("button", { name: "Remove Tile a" }));
    expect(gridTitles()).toEqual(["Tile b"]);
    const picker = document.querySelector<HTMLElement>(
      "[data-slot=dashboard-tile-picker]",
    )!;
    expect(within(picker).getByText("Tile a")).toBeTruthy();
    expect(within(picker).getByText("What a shows")).toBeTruthy();

    fireEvent.click(within(picker).getByRole("button", { name: "Add Tile a" }));
    expect(gridTitles()).toEqual(["Tile b", "Tile a"]);
  });

  it("reorders from the keyboard and saves the whole layout with the version it read", async () => {
    const links = await mount([tile("a"), tile("b"), tile("c")]);
    customize();

    const later = screen.getByRole("button", { name: "Move Tile a later" });
    later.focus();
    expect(document.activeElement).toBe(later);
    fireEvent.click(document.activeElement!);
    expect(gridTitles()).toEqual(["Tile b", "Tile a", "Tile c"]);
    expect(screen.getByText("Tile a moved to position 2 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Tile c" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => expect(links.saves).toHaveLength(1));
    expect(links.saves[0]).toEqual({
      version: 3,
      tiles: [
        { id: "b", enabled: true },
        { id: "a", enabled: true },
        { id: "c", enabled: false },
      ],
    });
    // Back to the dashboard.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Customize" })).toBeTruthy(),
    );
  });

  it("lists a tile this admin cannot see as unavailable, and keeps it in the saved layout", async () => {
    const links = await mount([
      tile("a"),
      tile("hidden", { can: () => false }),
    ]);
    customize();

    expect(gridTitles()).toEqual(["Tile a"]);
    const row = document.querySelector<HTMLElement>("[data-tile-id=hidden]")!;
    expect(within(row).getByText("Unavailable")).toBeTruthy();
    expect(within(row).queryByRole("button")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(links.saves).toHaveLength(1));
    expect(links.saves[0]!.tiles).toEqual([
      { id: "a", enabled: true },
      { id: "hidden", enabled: true },
    ]);
  });

  it("shows a notice for a concurrent save, offers a reload, and does not toast", async () => {
    await mount([tile("a")], (links) => {
      links.conflict = true;
    });
    customize();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() =>
      expect(
        screen.getByText("Another admin saved the layout meanwhile"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: "Load their layout" }),
    ).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      screen.queryByText("The dashboard layout was changed by another admin"),
    ).toBeNull();
    // Still editing: nothing was overwritten, and nothing was lost on screen.
    expect(gridTitles()).toEqual(["Tile a"]);
  });

  it("cancels without saving", async () => {
    const links = await mount([tile("a"), tile("b")]);
    customize();
    fireEvent.click(screen.getByRole("button", { name: "Remove Tile a" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(links.saves).toEqual([]);
    expect(screen.getByText("Open a")).toBeTruthy();
  });

  it("resets to the defaults only after a confirm, by saving an empty layout", async () => {
    const links = await mount([tile("a")]);
    customize();

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Reset the dashboard?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Reset to defaults" }),
      );
    });

    await waitFor(() => expect(links.saves).toHaveLength(1));
    expect(links.saves[0]).toEqual({ version: 3, tiles: [] });
  });
});
