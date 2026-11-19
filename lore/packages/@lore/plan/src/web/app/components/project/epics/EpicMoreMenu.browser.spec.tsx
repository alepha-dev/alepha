import { DialogProvider } from "@alepha/ui";
import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import EpicMoreMenu from "./EpicMoreMenu.tsx";

/**
 * Which entries the epic page's three-dots menu offers (#Q3908): Shelve or
 * Unshelve by status, Delete while the plan is open, each under its own
 * permission, and no menu at all when none is left.
 */
const perms = { shelve: true, unshelve: true, delete: true };
const deleted: number[] = [];

/**
 * Answers the three writes, each carrying the `can()` the spec set.
 */
class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = (fn: (...args: any[]) => unknown, can: () => boolean) =>
      Object.assign(fn, { can });
    return virtualClientFake({
      shelveEpic: action(
        async () => ({ ...anEpic, status: "shelved" }),
        () => perms.shelve,
      ),
      unshelveEpic: action(
        async () => ({ ...anEpic, status: "ready" }),
        () => perms.unshelve,
      ),
      deleteEpic: action(
        async (request: { params: { id: number } }) => {
          deleted.push(request.params.id);
          return { ok: true };
        },
        () => perms.delete,
      ),
    });
  }
}

const anEpic = {
  id: 7,
  projectId: 1,
  number: 157,
  title: "Epic menu",
  status: "ready",
  progress: { completed: 0, inProgress: 0, shelved: 0, total: 3 },
} as unknown as EpicResource;

describe("EpicMoreMenu", () => {
  const mount = async (
    status: EpicResource["status"],
    allowed: Partial<typeof perms> = {},
    progress: EpicResource["progress"] = anEpic.progress,
  ) => {
    Object.assign(perms, { shelve: true, unshelve: true, delete: true });
    Object.assign(perms, allowed);
    deleted.length = 0;
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    let left = 0;
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <EpicMoreMenu
            epic={{ ...anEpic, status, progress }}
            onChange={() => {}}
            onDeleted={() => {
              left += 1;
            }}
            invalidates={[]}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { left: () => left };
  };

  const entries = async () => {
    fireEvent.click(await screen.findByTestId("epic-more"));
    await screen.findAllByRole("menuitem");
    return screen.getAllByRole("menuitem").map((it) => it.textContent);
  };

  it("offers Shelve and Delete on a ready epic", async ({ expect }) => {
    await mount("ready");
    expect(await entries()).toEqual(["Shelve", "Delete"]);
  });

  it("offers Shelve alone once the epic has started", async ({ expect }) => {
    await mount("in_progress");
    expect(await entries()).toEqual(["Shelve"]);
  });

  it("offers Unshelve and Delete on a shelved epic with nothing completed (#Q3950)", async ({
    expect,
  }) => {
    await mount("shelved");
    expect(await entries()).toEqual(["Unshelve", "Delete"]);
  });

  it("offers no Delete on a shelved epic holding a completed quest", async ({
    expect,
  }) => {
    await mount("shelved", {}, {
      completed: 1,
      inProgress: 0,
      shelved: 2,
      total: 3,
    } as EpicResource["progress"]);
    expect(await entries()).toEqual(["Unshelve"]);
  });

  it("is absent on a completed epic", async ({ expect }) => {
    await mount("completed");
    await waitFor(() => expect(screen.queryByTestId("epic-more")).toBeNull());
  });

  it("drops an entry the reader's rank does not allow", async ({ expect }) => {
    await mount("draft", { delete: false });
    expect(await entries()).toEqual(["Shelve"]);
  });

  it("is absent when the rank allows neither", async ({ expect }) => {
    await mount("draft", { shelve: false, delete: false });
    await waitFor(() => expect(screen.queryByTestId("epic-more")).toBeNull());
  });

  it("deletes after the list's confirm, then leaves the page", async ({
    expect,
  }) => {
    const { left } = await mount("draft");
    fireEvent.click(await screen.findByTestId("epic-more"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain("Delete this epic?");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete" }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(left()).toBe(1));
    expect(deleted).toEqual([7]);
  });
});
